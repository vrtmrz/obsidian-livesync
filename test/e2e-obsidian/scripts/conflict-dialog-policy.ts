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
const thirdContent = "Conflict dialogue policy\n\nChanged on the third branch.\n";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_CONFLICT_DIALOG_TIMEOUT_MS ?? 10000);

type ConflictFixture = {
    currentRev: string;
    currentParentRev?: string;
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
    baseRev: string,
    contents: readonly string[]
): Promise<ConflictFixture> {
    return await evalObsidianJson<ConflictFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const baseRev=${JSON.stringify(baseRev)};`,
            `const contents=${JSON.stringify(contents)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const id=await core.services.path.path2id(path);",
            "for(const [index,content] of contents.entries()){",
            "  const blob=new Blob([content],{type:'text/plain'});",
            "  const now=Date.now()+index;",
            "  const result=await core.localDatabase.putDBEntry({",
            "    _id:id,path,data:blob,ctime:now,mtime:now,",
            "    size:(await blob.arrayBuffer()).byteLength,children:[],",
            "    datatype:'plain',type:'plain',eden:{},",
            "  },false,baseRev);",
            "  if(!result?.ok) throw new Error(`Could not create conflict branch: ${path}`);",
            "}",
            "const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
            "if(!meta?._rev||!meta._conflicts?.length){",
            "  throw new Error(`Conflict fixture did not produce multiple live leaves: ${path}`);",
            "}",
            "return JSON.stringify({currentRev:meta._rev,conflicts:meta._conflicts});",
            "})()",
        ].join(""),
        env
    );
}

async function readConflictFixture(cliBinary: string, env: NodeJS.ProcessEnv): Promise<ConflictFixture> {
    return await evalObsidianJson<ConflictFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true,revs:true},true);",
            "if(!meta?._rev){",
            "  throw new Error(`Could not read the conflict fixture: ${path}`);",
            "}",
            "const revisions=meta._revisions;",
            "const currentParentRev=revisions?.ids?.length>1",
            "  ? `${revisions.start-1}-${revisions.ids[1]}`",
            "  : undefined;",
            "return JSON.stringify({currentRev:meta._rev,currentParentRev,conflicts:meta._conflicts??[]});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForConflictCount(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    expectedConflictCount: number
): Promise<ConflictFixture> {
    const deadline = Date.now() + uiTimeoutMs;
    let fixture = await readConflictFixture(cliBinary, env);
    while (fixture.conflicts.length !== expectedConflictCount && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        fixture = await readConflictFixture(cliBinary, env);
    }
    if (fixture.conflicts.length !== expectedConflictCount) {
        throw new Error(
            `Expected ${expectedConflictCount + 1} live version(s), but found ${fixture.conflicts.length + 1}: ${JSON.stringify(fixture)}`
        );
    }
    return fixture;
}

async function requestConflictCheck(cliBinary: string, env: NodeJS.ProcessEnv, waitForCompletion = false) {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const waitForCompletion=${JSON.stringify(waitForCompletion)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.conflict.queueCheckFor(path);",
            "if(waitForCompletion){",
            "  await core.services.conflict.ensureAllProcessed();",
            "}",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForConflictChecks(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.conflict.ensureAllProcessed();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function applyReplicatedConflictResolution(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    revisionToDelete: string,
    expectedConflictCount = 0
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const revisionToDelete=${JSON.stringify(revisionToDelete)};`,
            `const expectedConflictCount=${JSON.stringify(expectedConflictCount)};`,
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
            "if(conflicts.length!==expectedConflictCount){",
            "  throw new Error(`Replicated resolution left an unexpected conflict count: ${path} ${JSON.stringify(conflicts)}`);",
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
        const fixture = await createManualConflict(cliBinary, session.cliEnv, base.rev, [
            leftContent,
            rightContent,
            thirdContent,
        ]);
        if (fixture.conflicts.length !== 2) {
            throw new Error(`Expected exactly three live leaves: ${JSON.stringify(fixture)}`);
        }

        await requestConflictCheck(cliBinary, session.cliEnv);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await page
                .locator(".livesync-status-messagearea")
                .filter({
                    hasText: "This file has 3 unresolved versions. They will be reviewed one pair at a time.",
                })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByRole("button", { name: "Concat both", exact: true }).waitFor({
                state: "visible",
                timeout: uiTimeoutMs,
            });
            const actionButtonBounds = await modal.locator(".conflict-action-button").evaluateAll((buttons) =>
                buttons.map((button) => {
                    const bounds = button.getBoundingClientRect();
                    return { top: bounds.top, bottom: bounds.bottom };
                })
            );
            if (
                actionButtonBounds.length !== 4 ||
                actionButtonBounds.some(
                    (bounds, index) => index > 0 && bounds.top < actionButtonBounds[index - 1].bottom
                )
            ) {
                throw new Error(
                    `Conflict action buttons are not stacked vertically: ${JSON.stringify(actionButtonBounds)}`
                );
            }
        });
        const firstDialogueScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-three-versions.png",
            (page) => conflictDialogue(page).locator(".modal").first()
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.getByRole("button", { name: "Concat both", exact: true }).click({ timeout: uiTimeoutMs });
        });

        const remainingAfterConcatenation = await waitForConflictCount(cliBinary, session.cliEnv, 1);
        if (
            remainingAfterConcatenation.currentRev === fixture.currentRev ||
            remainingAfterConcatenation.currentParentRev !== fixture.currentRev
        ) {
            throw new Error(
                `Concatenation did not extend the compared winner before retaining the remaining branch: ${JSON.stringify(
                    {
                        before: fixture,
                        after: remainingAfterConcatenation,
                    }
                )}`
            );
        }
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const warning = page.locator(".livesync-status-messagearea").filter({
                hasText: "This file has unresolved conflicts.",
            });
            await warning.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
        const warningScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-postponed-warning.png",
            (page) =>
                page.locator(".livesync-status-messagearea").filter({
                    hasText: "This file has unresolved conflicts.",
                })
        );

        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await createAndOpenBaseFile(cliBinary, session.cliEnv);
        const remainingAfterRestart = await waitForConflictCount(cliBinary, session.cliEnv, 1);

        await requestConflictCheck(cliBinary, session.cliEnv);
        const restartedSession = session;
        await withObsidianPage(restartedSession.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await page
                .locator(".livesync-status-messagearea")
                .filter({ hasText: "This file has unresolved conflicts." })
                .waitFor({ state: "visible", timeout: uiTimeoutMs });
            await applyReplicatedConflictResolution(
                cliBinary,
                restartedSession.cliEnv,
                remainingAfterRestart.conflicts[0]
            );
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
            await page
                .locator(".livesync-status-messagearea")
                .filter({ hasText: "This file has unresolved conflicts." })
                .waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        // End the replicated-resolution episode before creating another
        // conflict at the same path. This prevents a late cancellation event
        // from the first episode from closing the later episode's dialogue.
        await session.app.stop();
        session = undefined;
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await createAndOpenBaseFile(cliBinary, session.cliEnv);

        const resolved = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, path);
        const laterFixture = await createManualConflict(cliBinary, session.cliEnv, resolved.rev, [
            leftContent,
            rightContent,
        ]);
        if (laterFixture.conflicts.length !== 1) {
            throw new Error(`Expected a later conflict with exactly two live leaves: ${JSON.stringify(laterFixture)}`);
        }
        await requestConflictCheck(cliBinary, session.cliEnv);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await modal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
        await waitForConflictChecks(cliBinary, session.cliEnv);

        await requestConflictCheck(cliBinary, session.cliEnv, true);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.waitForTimeout(1500);
            if (await conflictDialogue(page).isVisible()) {
                throw new Error("The postponed conflict dialogue reopened during an ordinary conflict check.");
            }
        });
        await waitForConflictCount(cliBinary, session.cliEnv, 1);

        const laterCommandExecuted = await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            return await page.evaluate(
                (commandId) => (globalThis as ObsidianTestGlobal).app?.commands?.executeCommandById(commandId) === true,
                "obsidian-livesync:livesync-checkdoc-conflicted"
            );
        });
        if (!laterCommandExecuted) {
            throw new Error("The explicit conflict-resolution command was not registered for the active editor.");
        }
        const laterActiveSession = session;
        await withObsidianPage(laterActiveSession.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await applyReplicatedConflictResolution(cliBinary, laterActiveSession.cliEnv, laterFixture.conflicts[0]);
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
            await page
                .locator(".livesync-status-messagearea")
                .filter({ hasText: "This file has unresolved conflicts." })
                .waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });

        console.log(
            "Real Obsidian reviewed three versions pairwise, retained the completed stage across restart, suppressed an ordinary repeat prompt after Not now, reopened the dialogue after the explicit command, and cleared both postponed and open-dialogue states after replicated resolutions."
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
