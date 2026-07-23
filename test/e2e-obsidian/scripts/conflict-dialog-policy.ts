import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianElement, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const path = "conflict-dialog-policy.md";
const baseContent = "Conflict dialogue policy\n\nShared base.\n";
const leftContent = "Conflict dialogue policy\n\nChanged on the left.\n";
const rightContent = "Conflict dialogue policy\n\nChanged on the right.\n";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_CONFLICT_DIALOG_TIMEOUT_MS ?? 10000);

type ConflictFixture = {
    currentRev: string;
    conflicts: string[];
};

type ObsidianTestApp = {
    commands?: { executeCommandById(commandId: string): boolean };
};

type ObsidianTestGlobal = typeof globalThis & { app?: ObsidianTestApp };

async function createAndOpenBaseFile(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(baseContent)};`,
            "let file=app.vault.getAbstractFileByPath(path);",
            "if(!file) file=await app.vault.create(path,content);",
            "await app.workspace.getLeaf(false).openFile(file);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function createManualConflict(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    baseRev: string
): Promise<ConflictFixture> {
    return await evalObsidianJson<ConflictFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const baseRev=${JSON.stringify(baseRev)};`,
            `const contents=${JSON.stringify([leftContent, rightContent])};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "for(const content of contents){",
            "  const blob=new Blob([content],{type:'text/plain'});",
            "  const now=Date.now();",
            "  const result=await core.localDatabase.putDBEntry({",
            "    _id:id,path,data:blob,ctime:now,mtime:now,",
            "    size:(await blob.arrayBuffer()).byteLength,children:[],",
            "    datatype:'plain',type:'plain',eden:{},",
            "  },false,baseRev);",
            "  if(!result?.ok) throw new Error(`Could not create conflict branch: ${path}`);",
            "}",
            "const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
            "if(!meta?._rev||!meta._conflicts?.length){",
            "  throw new Error(`Conflict fixture did not produce two live leaves: ${path}`);",
            "}",
            "return JSON.stringify({currentRev:meta._rev,conflicts:meta._conflicts});",
            "})()",
        ].join(""),
        env
    );
}

async function requestConflictCheck(cliBinary: string, env: NodeJS.ProcessEnv, waitForCompletion: boolean) {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const waitForCompletion=${JSON.stringify(waitForCompletion)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const queued=core.services.conflict.queueCheckFor(path);",
            "if(waitForCompletion){",
            "  await queued;",
            "  await core.services.conflict.ensureAllProcessed();",
            "}",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function applyReplicatedConflictResolution(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    revisionToDelete: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const revisionToDelete=${JSON.stringify(revisionToDelete)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "if(!(await core.fileHandler.deleteRevisionFromDB(path,revisionToDelete))){",
            "  throw new Error(`Could not apply the replicated conflict resolution: ${path} ${revisionToDelete}`);",
            "}",
            "const entry=await core.databaseFileAccess.fetchEntryMeta(path,undefined,true);",
            "if(!entry){",
            "  throw new Error(`Could not read the surviving revision after replicated resolution: ${path}`);",
            "}",
            // This is the same Commonlib consumer boundary invoked after a remote
            // document has already entered the local database. Calling it here
            // isolates the dialogue policy from transport and second-device setup.
            "await core.fileHandler._anyProcessReplicatedDoc(entry);",
            "const conflicts=await core.databaseFileAccess.getConflictedRevs(path);",
            "if(conflicts.length!==0){",
            "  throw new Error(`Replicated resolution left conflicts behind: ${path} ${JSON.stringify(conflicts)}`);",
            "}",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

function conflictDialogue(page: Parameters<Parameters<typeof withObsidianPage>[1]>[0]) {
    return page.locator(".modal-container").filter({
        has: page.locator(".modal-title").filter({ hasText: "Conflicting changes" }),
    });
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const cliBinary = cli.binary;

    const vault = await createTemporaryVault("obsidian-livesync-conflict-dialog-");
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
            pluginData: {
                doctorProcessedVersion: "1.0.0",
                isConfigured: true,
                liveSync: false,
                remoteType: "",
                couchDB_URI: "http://127.0.0.1:5984",
                couchDB_DBNAME: "conflict-dialog-policy",
                couchDB_USER: "",
                couchDB_PASSWORD: "",
                notifyThresholdOfRemoteStorageSize: -1,
                periodicReplication: false,
                syncAfterMerge: false,
                syncOnEditorSave: false,
                syncOnFileOpen: false,
                syncOnSave: false,
                syncOnStart: false,
                disableMarkdownAutoMerge: true,
                showMergeDialogOnlyOnActive: true,
                showStatusOnEditor: true,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await createAndOpenBaseFile(cliBinary, session.cliEnv);
        const base = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, path);
        const fixture = await createManualConflict(cliBinary, session.cliEnv, base.rev);
        if (fixture.conflicts.length !== 1) {
            throw new Error(`Expected exactly two live leaves: ${JSON.stringify(fixture)}`);
        }

        await requestConflictCheck(cliBinary, session.cliEnv, false);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByRole("button", { name: "Not now", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
        });
        const firstDialogueScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-before-not-now.png",
            (page) => conflictDialogue(page).locator(".modal").first()
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        await requestConflictCheck(cliBinary, session.cliEnv, true);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const warning = page.locator(".livesync-status-messagearea").filter({
                hasText: "This file has unresolved conflicts.",
            });
            await warning.waitFor({ state: "visible", timeout: uiTimeoutMs });
            if (await conflictDialogue(page).isVisible()) {
                throw new Error("The postponed conflict dialogue reopened during an ordinary conflict check.");
            }
        });
        const warningScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-postponed-warning.png",
            (page) =>
                page.locator(".livesync-status-messagearea").filter({
                    hasText: "This file has unresolved conflicts.",
                })
        );

        await applyReplicatedConflictResolution(cliBinary, session.cliEnv, fixture.conflicts[0]);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await conflictDialogue(page).waitFor({ state: "hidden", timeout: uiTimeoutMs });
            await page
                .locator(".livesync-status-messagearea")
                .filter({ hasText: "This file has unresolved conflicts." })
                .waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        const resolved = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, path);
        const laterFixture = await createManualConflict(cliBinary, session.cliEnv, resolved.rev);
        if (laterFixture.conflicts.length !== 1) {
            throw new Error(`Expected a later conflict with exactly two live leaves: ${JSON.stringify(laterFixture)}`);
        }
        await requestConflictCheck(cliBinary, session.cliEnv, false);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        const commandExecuted = await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            return await page.evaluate(
                (commandId) => (globalThis as ObsidianTestGlobal).app?.commands?.executeCommandById(commandId) === true,
                "obsidian-livesync:livesync-checkdoc-conflicted"
            );
        });
        if (!commandExecuted) {
            throw new Error("The explicit conflict-resolution command was not registered for the active editor.");
        }
        const activeSession = session;
        await withObsidianPage(activeSession.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await applyReplicatedConflictResolution(cliBinary, activeSession.cliEnv, laterFixture.conflicts[0]);
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
            await page
                .locator(".livesync-status-messagearea")
                .filter({ hasText: "This file has unresolved conflicts." })
                .waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        console.log(
            "Real Obsidian retained the conflict warning, suppressed an ordinary repeat prompt, reopened the dialogue after the explicit command, and cleared both postponed and open-dialogue states after replicated resolutions."
        );
        console.log(`Dialogue screenshot: ${firstDialogueScreenshot}`);
        console.log(`Postponed warning screenshot: ${warningScreenshot}`);
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
