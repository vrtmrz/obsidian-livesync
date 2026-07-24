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

const path = "revision-repair.md";
const baseContent = "Revision repair\n\nShared base.\n";
const branchContents = [
    `Revision repair\n\nLeft branch.\n${"L".repeat(4096)}\n`,
    `Revision repair\n\nRight branch.\n${"R".repeat(4096)}\n`,
] as const;
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_REVISION_REPAIR_TIMEOUT_MS ?? 15000);

type BrokenRevisionFixture = {
    winnerRevision: string;
    conflictRevision: string;
    missingChunkId: string;
};

type RevisionTree = {
    winnerRevision: string;
    conflictRevisions: string[];
};

type ObsidianSettingsController = {
    open(): void;
    openTabById(tabId: string): void;
};

type ObsidianTestGlobal = typeof globalThis & {
    app?: {
        setting?: ObsidianSettingsController;
    };
};

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

async function createBrokenConflict(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    baseRevision: string
): Promise<BrokenRevisionFixture> {
    return await evalObsidianJson<BrokenRevisionFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const baseRevision=${JSON.stringify(baseRevision)};`,
            `const contents=${JSON.stringify(branchContents)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "for(const [index,content] of contents.entries()){",
            "  const blob=new Blob([content],{type:'text/plain'});",
            "  const now=Date.now()+index;",
            "  const result=await core.localDatabase.putDBEntry({",
            "    _id:id,path,data:blob,ctime:now,mtime:now,",
            "    size:(await blob.arrayBuffer()).byteLength,children:[],",
            "    datatype:'plain',type:'plain',eden:{},",
            "  },false,baseRevision);",
            "  if(!result?.ok) throw new Error(`Could not create repair conflict: ${path}`);",
            "}",
            "const tree=await core.localDatabase.localDatabase.get(id,{conflicts:true});",
            "const conflictRevision=tree._conflicts?.[0];",
            "if(!tree._rev||!conflictRevision){",
            "  throw new Error(`Repair fixture did not produce two live revisions: ${path}`);",
            "}",
            "const conflict=await core.localDatabase.localDatabase.get(id,{rev:conflictRevision});",
            "const embedded=new Set(Object.keys(conflict.eden??{}));",
            "const missingChunkId=(conflict.children??[]).find((child)=>!embedded.has(child));",
            "if(!missingChunkId){",
            "  throw new Error(`Repair fixture did not create an independent chunk: ${conflictRevision}`);",
            "}",
            "const chunk=await core.localDatabase.localDatabase.get(missingChunkId);",
            "await core.localDatabase.localDatabase.remove(chunk);",
            "core.localDatabase.clearCaches();",
            "const unreadable=await core.localDatabase.getDBEntry(path,{rev:conflictRevision},false,true,true);",
            "if(unreadable!==false){",
            "  throw new Error(`The selected revision remained readable after its chunk was removed: ${conflictRevision}`);",
            "}",
            "return JSON.stringify({",
            "  winnerRevision:tree._rev,",
            "  conflictRevision,",
            "  missingChunkId,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function readRevisionTree(cliBinary: string, env: NodeJS.ProcessEnv): Promise<RevisionTree> {
    return await evalObsidianJson<RevisionTree>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "const tree=await core.localDatabase.localDatabase.get(id,{conflicts:true});",
            "return JSON.stringify({",
            "  winnerRevision:tree._rev,",
            "  conflictRevisions:tree._conflicts??[],",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function requestConflictCheck(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "core.localDatabase.clearCaches();",
            "await core.services.conflict.queueCheckFor(path);",
            "await core.services.conflict.ensureAllProcessed();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }
    const cliBinary = cli.binary;
    const vault = await createTemporaryVault("obsidian-livesync-revision-repair-");
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
                disableMarkdownAutoMerge: true,
                showMergeDialogOnlyOnActive: true,
                useEden: false,
            },
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await createAndOpenBaseFile(cliBinary, session.cliEnv);
        const base = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, path);
        const fixture = await createBrokenConflict(cliBinary, session.cliEnv, base.rev);

        await requestConflictCheck(cliBinary, session.cliEnv);
        const afterAutomaticCheck = await readRevisionTree(cliBinary, session.cliEnv);
        if (
            afterAutomaticCheck.winnerRevision !== fixture.winnerRevision ||
            !afterAutomaticCheck.conflictRevisions.includes(fixture.conflictRevision)
        ) {
            throw new Error(
                `Automatic conflict checking discarded the unreadable revision: ${JSON.stringify({
                    fixture,
                    afterAutomaticCheck,
                })}`
            );
        }

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.evaluate(() => {
                const setting = (globalThis as ObsidianTestGlobal).app?.setting;
                if (setting === undefined) throw new Error("Obsidian settings are unavailable");
                setting.open();
                setting.openTabById("obsidian-livesync");
            });
            const settings = page.locator(".sls-setting");
            await settings.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await settings.locator('.sls-setting-menu-btn[title="Hatch"]').click({ timeout: uiTimeoutMs });
            const verifySetting = settings.locator(".setting-item").filter({
                has: page.getByText("Verify and repair all files", { exact: true }),
            });
            await verifySetting.getByRole("button", { name: "Verify all", exact: true }).click({
                timeout: uiTimeoutMs,
            });
            const card = settings.locator(".sls-repair-result").filter({ hasText: path });
            await card.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const brokenRevision = card
                .locator(".sls-repair-revision")
                .filter({ hasText: fixture.conflictRevision });
            await brokenRevision
                .getByText(/Unreadable on this device/u)
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await brokenRevision.getByText(fixture.missingChunkId, { exact: false }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            if ((await card.locator(".sls-repair-revision").count()) !== 2) {
                throw new Error("Verify and Repair did not render the winner and conflict revision separately.");
            }

            await brokenRevision.getByRole("button", { name: "Retry reading revision", exact: true }).click({
                timeout: uiTimeoutMs,
            });
            await settings
                .locator(".sls-repair-result")
                .filter({ hasText: path })
                .locator(".sls-repair-revision")
                .filter({ hasText: fixture.conflictRevision })
                .getByText(/Unreadable on this device/u)
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
        });

        const afterRetry = await readRevisionTree(cliBinary, session.cliEnv);
        if (!afterRetry.conflictRevisions.includes(fixture.conflictRevision)) {
            throw new Error(`Retry changed the revision tree: ${JSON.stringify(afterRetry)}`);
        }

        const screenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "revision-repair-unreadable-conflict.png",
            (page) => page.locator(".sls-repair-result").filter({ hasText: path })
        );

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            const brokenRevision = () =>
                settings
                    .locator(".sls-repair-result")
                    .filter({ hasText: path })
                    .locator(".sls-repair-revision")
                    .filter({ hasText: fixture.conflictRevision });
            await brokenRevision()
                .getByRole("button", { name: "Discard unreadable revision", exact: true })
                .click({ timeout: uiTimeoutMs });
            const confirmation = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Discard unreadable revision" }),
            });
            await confirmation.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await confirmation.getByRole("button", { name: "No", exact: true }).click({ timeout: uiTimeoutMs });
            await confirmation.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        const afterCancellation = await readRevisionTree(cliBinary, session.cliEnv);
        if (!afterCancellation.conflictRevisions.includes(fixture.conflictRevision)) {
            throw new Error(`Cancelling discard changed the revision tree: ${JSON.stringify(afterCancellation)}`);
        }

        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const settings = page.locator(".sls-setting");
            const brokenRevision = settings
                .locator(".sls-repair-result")
                .filter({ hasText: path })
                .locator(".sls-repair-revision")
                .filter({ hasText: fixture.conflictRevision });
            await brokenRevision
                .getByRole("button", { name: "Discard unreadable revision", exact: true })
                .click({ timeout: uiTimeoutMs });
            const confirmation = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Discard unreadable revision" }),
            });
            await confirmation.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await confirmation.getByRole("button", { name: "Yes", exact: true }).click({ timeout: uiTimeoutMs });
            await settings
                .locator(".sls-repair-revision")
                .filter({ hasText: fixture.conflictRevision })
                .waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        const afterDiscard = await readRevisionTree(cliBinary, session.cliEnv);
        if (
            afterDiscard.winnerRevision !== fixture.winnerRevision ||
            afterDiscard.conflictRevisions.length !== 0
        ) {
            throw new Error(
                `Explicit discard did not remove only the selected unreadable revision: ${JSON.stringify({
                    fixture,
                    afterDiscard,
                })}`
            );
        }

        console.log(
            "Real Obsidian kept an unreadable conflict revision through automatic checking and retry, rendered every live revision separately, required confirmation, and discarded only the selected revision."
        );
        console.log(`Repair screenshot: ${screenshot}`);
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
