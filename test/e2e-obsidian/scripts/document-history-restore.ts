import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { evalObsidianJson } from "../runner/cli.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";
process.env.E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS ??= "60000";
process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ??= "30000";

const notePath = "E2E/document-history-soft-deleted.md";
const contentMarker = "Recoverable content from the soft-deleted revision";
const noteContent = [
    "# Document History recovery E2E",
    "",
    contentMarker,
    "",
    ...Array.from(
        { length: 96 },
        (_, index) => `Preserved content line ${String(index + 1).padStart(3, "0")}: ${"R".repeat(64)}`
    ),
    "",
].join("\n");

type SoftDeletionState = {
    id: string;
    revision: string;
    revisionCount: number;
    chunkReferences: number;
    availableChunks: number;
    contentReadable: boolean;
    storageExists: boolean;
};

type VaultRestoreState = {
    revision: string;
    revisionCount: number;
    deleted: boolean;
    storageExists: boolean;
    contentMatches: boolean;
};

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function assertTrue(value: boolean, message: string): void {
    if (!value) {
        throw new Error(message);
    }
}

async function dismissWelcomeWizard(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        const cancel = page.getByText("No, please take me back");
        if (await cancel.isVisible({ timeout: 5000 }).catch(() => false)) {
            await cancel.click();
            await page.waitForTimeout(500);
        }
    });
}

async function createNote(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            `const content=${JSON.stringify(noteContent)};`,
            "if(!(await app.vault.adapter.exists('E2E'))) await app.vault.createFolder('E2E');",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.delete(existing);",
            "const file=await app.vault.create(path,content);",
            "await app.workspace.getLeaf(false).openFile(file);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
    await waitForLocalDatabaseEntry(cliBinary, env, notePath);
}

async function createSoftDeletion(cliBinary: string, env: NodeJS.ProcessEnv): Promise<SoftDeletionState> {
    return await evalObsidianJson<SoftDeletionState>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            `const expectedContent=${JSON.stringify(noteContent)};`,
            "const timeoutMs=30000;",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const file=app.vault.getAbstractFileByPath(path);",
            "if(!file) throw new Error(`Recovery fixture is missing from the Vault: ${path}`);",
            "const id=await core.services.path.path2id(path);",
            "await app.vault.delete(file);",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "while(Date.now()<deadline){",
            "  await core.services.fileProcessing.commitPendingFileEvents();",
            "  const raw=await core.localDatabase.getRaw(id,{revs_info:true}).catch(()=>false);",
            "  if(raw?.deleted&&!app.vault.getAbstractFileByPath(path)){",
            "    const loaded=await core.localDatabase.getDBEntry(path,{rev:raw._rev},false,true,true);",
            "    const loadedContent=loaded===false?'':Array.isArray(loaded.data)?loaded.data.join(''):loaded.data;",
            "    const children=Array.isArray(raw.children)?raw.children:[];",
            "    const chunkRows=children.length===0?{rows:[]}:await core.localDatabase.allDocsRaw({keys:children,include_docs:true});",
            "    const availableChunks=chunkRows.rows.filter((row)=>row.doc&&!row.value?.deleted).length;",
            "    return JSON.stringify({",
            "      id,",
            "      revision:raw._rev,",
            "      revisionCount:(raw._revs_info||[]).filter((entry)=>entry?.status==='available').length,",
            "      chunkReferences:children.length,",
            "      availableChunks,",
            "      contentReadable:loadedContent===expectedContent,",
            "      storageExists:!!app.vault.getAbstractFileByPath(path),",
            "    });",
            "  }",
            "  await sleep(250);",
            "}",
            "throw new Error(`Timed out waiting for a readable soft deletion: ${path}`);",
            "})()",
        ].join(""),
        env
    );
}

async function openHistoryPicker(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "document.querySelectorAll('.modal-close-button').forEach((button)=>button.click());",
            "await new Promise((resolve)=>setTimeout(resolve,300));",
            "await app.commands.executeCommandById('obsidian-livesync:livesync-filehistory');",
            "await new Promise((resolve)=>setTimeout(resolve,500));",
            "return JSON.stringify({opened:!!document.querySelector('.prompt-input')});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForVaultRestore(cliBinary: string, env: NodeJS.ProcessEnv): Promise<VaultRestoreState> {
    return await evalObsidianJson<VaultRestoreState>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            `const expectedContent=${JSON.stringify(noteContent)};`,
            "const timeoutMs=30000;",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "while(Date.now()<deadline){",
            "  await core.services.fileProcessing.commitPendingFileEvents();",
            "  const file=app.vault.getAbstractFileByPath(path);",
            "  const raw=await core.localDatabase.getRaw(id,{revs_info:true}).catch(()=>false);",
            "  const content=file?await app.vault.read(file):'';",
            "  if(file&&raw&&!raw.deleted&&!raw._deleted&&content===expectedContent){",
            "    return JSON.stringify({",
            "      revision:raw._rev,",
            "      revisionCount:(raw._revs_info||[]).filter((entry)=>entry?.status==='available').length,",
            "      deleted:false,",
            "      storageExists:true,",
            "      contentMatches:true,",
            "    });",
            "  }",
            "  await sleep(250);",
            "}",
            "const file=app.vault.getAbstractFileByPath(path);",
            "const raw=await core.localDatabase.getRaw(id,{revs_info:true}).catch(()=>false);",
            "const content=file?await app.vault.read(file):'';",
            "throw new Error(`Timed out waiting for History to create and reflect a live successor revision: ${JSON.stringify({storageExists:!!file,deleted:!!(raw&&((raw.deleted||raw._deleted))),contentMatches:content===expectedContent,revision:raw&&raw._rev})}`);",
            "})()",
        ].join(""),
        env
    );
}

async function openActiveFileHistory(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            "document.querySelectorAll('.modal-close-button').forEach((button)=>button.click());",
            "const file=app.vault.getAbstractFileByPath(path);",
            "if(!file) throw new Error(`Restored file is missing before reopening history: ${path}`);",
            "await app.workspace.getLeaf(false).openFile(file);",
            "await new Promise((resolve)=>setTimeout(resolve,300));",
            "await app.commands.executeCommandById('obsidian-livesync:livesync-history');",
            "await new Promise((resolve)=>setTimeout(resolve,500));",
            "return JSON.stringify({opened:!!document.querySelector('.modal-container .modal-title')});",
            "})()",
        ].join(""),
        env
    );
}

async function captureStep(page: Page, screenshotDir: string, step: string): Promise<string> {
    await mkdir(screenshotDir, { recursive: true });
    const path = join(screenshotDir, `${step}.png`);
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    console.log(`Screenshot: ${path}`);
    return path;
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);

    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    const screenshotDir =
        process.env.E2E_OBSIDIAN_HISTORY_RESTORE_SCREENSHOT_DIR ??
        join(process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e", "document-history-restore");
    const reportPath =
        process.env.E2E_OBSIDIAN_HISTORY_RESTORE_REPORT ?? join(screenshotDir, "document-history-restore.json");

    try {
        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                doctorProcessedVersion: "1.0.0",
                isConfigured: true,
                liveSync: false,
                remoteType: "",
                couchDB_URI: "",
                couchDB_DBNAME: "",
                couchDB_USER: "",
                couchDB_PASSWORD: "",
                remoteConfigurations: {},
                activeConfigurationId: "",
                notifyThresholdOfRemoteStorageSize: -1,
                periodicReplication: false,
                syncAfterMerge: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncOnSave: false,
                syncOnStart: false,
                deleteMetadataOfDeletedFiles: false,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        await dismissWelcomeWizard(session.remoteDebuggingPort);

        await createNote(cli.binary, session.cliEnv);
        const deletion = await createSoftDeletion(cli.binary, session.cliEnv);
        assertEqual(deletion.storageExists, false, "The deletion fixture still existed in the Vault.");
        assertTrue(deletion.chunkReferences > 0, "The deleted document did not retain chunk references.");
        assertEqual(
            deletion.availableChunks,
            deletion.chunkReferences,
            "Not all chunks referenced by the deleted document remained available."
        );
        assertEqual(
            deletion.contentReadable,
            true,
            "The soft-deleted revision could not be reconstructed from chunks."
        );

        await openHistoryPicker(cli.binary, session.cliEnv);

        const screenshots = await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const screenshotPaths: string[] = [];
            const prompt = page.locator(".prompt");
            await prompt.waitFor({ state: "visible", timeout: 10000 });
            const promptInput = prompt.locator(".prompt-input");
            assertEqual(
                await promptInput.getAttribute("placeholder"),
                "File to view History",
                "Unexpected history picker placeholder."
            );
            await promptInput.fill(notePath);
            const suggestion = prompt.locator(".suggestion-item").filter({ hasText: notePath }).first();
            await suggestion.waitFor({ state: "visible", timeout: 10000 });
            screenshotPaths.push(await captureStep(page, screenshotDir, "01-soft-deleted-file-picker"));

            await suggestion.click();
            const modal = page.locator(".modal-container").filter({ hasText: "Document History" });
            await modal.waitFor({ state: "visible", timeout: 10000 });
            await modal.getByText("(At this revision, the file has been deleted)", { exact: false }).waitFor({
                state: "visible",
                timeout: 10000,
            });
            await modal.getByText(contentMarker, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
            const restoreButton = modal.getByRole("button", { name: "Back to this revision", exact: true });
            await restoreButton.waitFor({ state: "visible", timeout: 10000 });
            screenshotPaths.push(await captureStep(page, screenshotDir, "02-readable-deleted-revision"));

            await restoreButton.click();
            await modal.waitFor({ state: "hidden", timeout: 10000 });
            return screenshotPaths;
        });

        const restored = await waitForVaultRestore(cli.binary, session.cliEnv);
        assertEqual(restored.storageExists, true, "Document History did not restore the Vault file.");
        assertEqual(restored.contentMatches, true, "The restored Vault file did not match the deleted revision.");
        assertEqual(restored.deleted, false, "Document History did not produce a live database revision.");
        assertTrue(
            restored.revision !== deletion.revision,
            "Document History did not create a successor database revision."
        );
        assertEqual(
            restored.revisionCount,
            deletion.revisionCount + 1,
            "Document History did not add exactly one live successor revision."
        );

        screenshots.push(
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                await page
                    .getByText(contentMarker, { exact: false })
                    .first()
                    .waitFor({ state: "visible", timeout: 10000 });
                return await captureStep(page, screenshotDir, "03-live-successor-after-history-restore");
            })
        );

        await openActiveFileHistory(cli.binary, session.cliEnv);
        screenshots.push(
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                const modal = page.locator(".modal-container").filter({ hasText: "Document History" });
                await modal.waitFor({ state: "visible", timeout: 10000 });
                await modal.getByText(contentMarker, { exact: false }).waitFor({ state: "visible", timeout: 10000 });
                assertEqual(
                    await modal.getByText("(At this revision, the file has been deleted)", { exact: false }).count(),
                    0,
                    "The live successor revision was still displayed as deleted."
                );
                assertEqual(
                    (await modal.locator(".history-rev-indicator").innerText()).trim(),
                    "Rev 3/3",
                    "Document History did not open at the new live successor revision."
                );
                return await captureStep(page, screenshotDir, "04-restored-revision-in-history");
            })
        );

        await mkdir(screenshotDir, { recursive: true });
        await writeFile(
            reportPath,
            `${JSON.stringify({ notePath, deletion, restored, screenshots }, null, 2)}\n`,
            "utf-8"
        );
        console.log("Document History soft-deletion restoration E2E passed.");
        console.log(`Report: ${reportPath}`);
        console.log(`Screenshots: ${screenshotDir}`);
    } finally {
        if (session) await session.app.stop();
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
