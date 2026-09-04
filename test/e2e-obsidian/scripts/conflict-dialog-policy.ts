import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    createE2eObsidianDeviceLocalState,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianElement, captureObsidianPage, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault } from "../runner/vault.ts";

const path = "conflict-dialog-policy.md";
const baseContent = "Conflict dialogue policy\n\nShared base.\n";
const leftContent = "Conflict dialogue policy\n\nChanged on the left.\n";
const rightContent = "Conflict dialogue policy\n\nChanged on the right.\n";
const thirdContent = "Conflict dialogue policy\n\nChanged on the third branch.\n";
const repeatedPath = "conflict-dialog-repeated.md";
const activePath = "conflict-dialog-active.md";
const waitingPath = "conflict-dialog-waiting.md";
const externallyResolvedWaitingPath = "conflict-dialog-resolved-while-waiting.md";
const unloadActivePath = "conflict-dialog-unload-active.md";
const unloadWaitingPath = "conflict-dialog-unload-waiting.md";
const uiTimeoutMs = Number(process.env.E2E_OBSIDIAN_CONFLICT_DIALOG_TIMEOUT_MS ?? 10000);

type ConflictFixture = {
    currentRev: string;
    currentParentRev?: string;
    conflicts: string[];
};

type ObsidianTestApp = {
    commands?: { executeCommandById(commandId: string): boolean };
    plugins?: {
        disablePlugin(pluginId: string): Promise<void>;
        enablePlugin(pluginId: string): Promise<void>;
        plugins?: Record<
            string,
            | {
                  core?: {
                      services?: {
                          conflict?: { ensureAllProcessed(): Promise<boolean> };
                      };
                  };
              }
            | undefined
        >;
    };
};

type ObsidianTestGlobal = typeof globalThis & {
    app?: ObsidianTestApp;
    __livesyncConflictChecksCompleted?: boolean;
    __livesyncWaitingConflictCompleted?: boolean;
};

async function createAndOpenBaseFile(cliBinary: string, env: NodeJS.ProcessEnv, targetPath = path): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(targetPath)};`,
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
    contents: readonly string[],
    targetPath = path
): Promise<ConflictFixture> {
    return await evalObsidianJson<ConflictFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(targetPath)};`,
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

async function readConflictFixture(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    targetPath = path
): Promise<ConflictFixture> {
    return await evalObsidianJson<ConflictFixture>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(targetPath)};`,
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
    expectedConflictCount: number,
    targetPath = path
): Promise<ConflictFixture> {
    const deadline = Date.now() + uiTimeoutMs;
    let fixture = await readConflictFixture(cliBinary, env, targetPath);
    while (fixture.conflicts.length !== expectedConflictCount && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        fixture = await readConflictFixture(cliBinary, env, targetPath);
    }
    if (fixture.conflicts.length !== expectedConflictCount) {
        throw new Error(
            `Expected ${expectedConflictCount + 1} live version(s), but found ${fixture.conflicts.length + 1}: ${JSON.stringify(fixture)}`
        );
    }
    return fixture;
}

async function requestConflictCheck(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    waitForCompletion = false,
    targetPath = path
) {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(targetPath)};`,
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
    expectedConflictCount = 0,
    targetPath = path
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(targetPath)};`,
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

function conflictDialogue(page: Parameters<Parameters<typeof withObsidianPage>[1]>[0], targetPath?: string) {
    const dialogues = page.locator(".modal-container").filter({
        has: page.locator(".modal-title").filter({ hasText: "Conflicting changes" }),
    });
    return targetPath === undefined ? dialogues : dialogues.filter({ hasText: targetPath });
}

async function createTwoVersionConflict(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    targetPath: string
): Promise<ConflictFixture> {
    await createAndOpenBaseFile(cliBinary, env, targetPath);
    const base = await waitForLocalDatabaseEntry(cliBinary, env, targetPath);
    const fixture = await createManualConflict(cliBinary, env, base.rev, [leftContent, rightContent], targetPath);
    if (fixture.conflicts.length !== 1) {
        throw new Error(`Expected exactly two live leaves for ${targetPath}: ${JSON.stringify(fixture)}`);
    }
    return fixture;
}

async function setShowMergeDialogOnlyOnActive(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    enabled: boolean
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(()=>{",
            `const enabled=${JSON.stringify(enabled)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "core.settings.showMergeDialogOnlyOnActive=enabled;",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function requestRepeatedConflictChecks(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    targetPath: string,
    count: number
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(targetPath)};`,
            `const count=${JSON.stringify(count)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await Promise.all(Array.from({length:count},()=>core.services.conflict.queueCheckFor(path)));",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function requestInteractiveConflictResolution(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    targetPath: string,
    fixture: ConflictFixture,
    trackCompletion = false
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(()=>{",
            `const path=${JSON.stringify(targetPath)};`,
            `const currentRev=${JSON.stringify(fixture.currentRev)};`,
            `const conflictRev=${JSON.stringify(fixture.conflicts[0])};`,
            `const trackCompletion=${JSON.stringify(trackCompletion)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "if(trackCompletion) globalThis.__livesyncWaitingConflictCompleted=false;",
            "const pending=core.services.conflict.resolveByUserInteraction(path,{",
            "left:{rev:currentRev,data:'Current branch',ctime:1,mtime:2},",
            "right:{rev:conflictRev,data:'Conflict branch',ctime:1,mtime:3},",
            "diff:[[0,'Current and conflict branches']],",
            "});",
            "if(trackCompletion) void pending.then(()=>{globalThis.__livesyncWaitingConflictCompleted=true;});",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function disableLiveSyncAndWaitForConflictChecks(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(() => {
            const host = globalThis as ObsidianTestGlobal;
            const conflict = host.app?.plugins?.plugins?.["obsidian-livesync"]?.core?.services?.conflict;
            if (conflict === undefined) throw new Error("LiveSync conflict service is unavailable before unload");
            host.__livesyncConflictChecksCompleted = false;
            void conflict.ensureAllProcessed().then(() => {
                host.__livesyncConflictChecksCompleted = true;
            });
        });
        await page.evaluate(async () => {
            const plugins = (globalThis as ObsidianTestGlobal).app?.plugins;
            if (plugins === undefined) throw new Error("Obsidian plug-in manager is unavailable");
            await plugins.disablePlugin("obsidian-livesync");
        });
        await conflictDialogue(page).waitFor({ state: "hidden", timeout: uiTimeoutMs });
        await page.waitForFunction(
            () => {
                const host = globalThis as ObsidianTestGlobal;
                return (
                    host.__livesyncConflictChecksCompleted === true && host.__livesyncWaitingConflictCompleted === true
                );
            },
            undefined,
            { timeout: uiTimeoutMs }
        );
    });
}

async function enableLiveSync(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(async () => {
            const plugins = (globalThis as ObsidianTestGlobal).app?.plugins;
            if (plugins === undefined) throw new Error("Obsidian plug-in manager is unavailable");
            await plugins.enablePlugin("obsidian-livesync");
        });
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
        });
        const firstDialogueScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-three-versions.png",
            (page) => conflictDialogue(page).locator(".modal").first()
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page);
            const actionButtons = modal.locator(".conflict-action-button");
            await actionButtons.nth(3).waitFor({ state: "visible", timeout: uiTimeoutMs });
            const actionButtonBounds = await actionButtons.evaluateAll((buttons) =>
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
                const buttonDetails = await modal.locator("button").evaluateAll((buttons) =>
                    buttons.map((button) => ({
                        text: button.textContent,
                        className: button.className,
                    }))
                );
                throw new Error(
                    `Conflict action buttons are not stacked vertically: ${JSON.stringify({
                        actionButtonBounds,
                        buttonDetails,
                    })}`
                );
            }
        });
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

        // Keep concurrent manual comparisons independent from the active-file
        // gate so that the dialogue serialisation policy is exercised directly.
        await setShowMergeDialogOnlyOnActive(cliBinary, session.cliEnv, false);

        await createTwoVersionConflict(cliBinary, session.cliEnv, repeatedPath);
        await requestConflictCheck(cliBinary, session.cliEnv, false, repeatedPath);
        const repeatedSession = session;
        await withObsidianPage(repeatedSession.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page, repeatedPath);
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            const original = await modal.elementHandle();
            if (original === null) throw new Error("Could not retain the original same-file conflict dialogue");

            await requestRepeatedConflictChecks(cliBinary, repeatedSession.cliEnv, repeatedPath, 3);
            await page.waitForFunction((element) => !element.isConnected, original, { timeout: uiTimeoutMs });
            await modal.waitFor({ state: "visible", timeout: uiTimeoutMs });
            await page.waitForTimeout(250);
            const visibleCount = await conflictDialogue(page, repeatedPath).evaluateAll(
                (elements) => elements.filter((element) => element.getClientRects().length > 0).length
            );
            if (visibleCount !== 1) {
                throw new Error(`Expected one newest same-file dialogue, but found ${visibleCount}`);
            }
        });
        const repeatedDialogueScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-same-file-replacement.png",
            (page) => conflictDialogue(page, repeatedPath).locator(".modal").first()
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page, repeatedPath);
            await modal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
        await waitForConflictChecks(cliBinary, session.cliEnv);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.waitForTimeout(500);
            if (await conflictDialogue(page, repeatedPath).isVisible()) {
                throw new Error("A superseded same-file conflict dialogue opened after the newest request completed");
            }
        });

        await createTwoVersionConflict(cliBinary, session.cliEnv, activePath);
        await createTwoVersionConflict(cliBinary, session.cliEnv, waitingPath);
        const externallyResolvedWaitingFixture = await createTwoVersionConflict(
            cliBinary,
            session.cliEnv,
            externallyResolvedWaitingPath
        );
        await requestConflictCheck(cliBinary, session.cliEnv, false, activePath);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await conflictDialogue(page, activePath).waitFor({ state: "visible", timeout: uiTimeoutMs });
        });
        await requestConflictCheck(cliBinary, session.cliEnv, false, waitingPath);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.waitForTimeout(500);
            if (!(await conflictDialogue(page, activePath).isVisible())) {
                throw new Error("A different-file request closed the active conflict dialogue");
            }
            if (await conflictDialogue(page, waitingPath).isVisible()) {
                throw new Error("A different-file conflict dialogue opened before the active dialogue completed");
            }
        });
        const differentFileWaitingScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-different-file-waiting.png",
            (page) => conflictDialogue(page, activePath).locator(".modal").first()
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const activeModal = conflictDialogue(page, activePath);
            await activeModal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await activeModal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
            await conflictDialogue(page, waitingPath).waitFor({ state: "visible", timeout: uiTimeoutMs });
        });

        await requestInteractiveConflictResolution(
            cliBinary,
            session.cliEnv,
            externallyResolvedWaitingPath,
            externallyResolvedWaitingFixture,
            true
        );
        await applyReplicatedConflictResolution(
            cliBinary,
            session.cliEnv,
            externallyResolvedWaitingFixture.conflicts[0],
            0,
            externallyResolvedWaitingPath
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            if (!(await conflictDialogue(page, waitingPath).isVisible())) {
                throw new Error("Resolving a waiting file elsewhere closed the active different-file dialogue");
            }
            if (await conflictDialogue(page, externallyResolvedWaitingPath).isVisible()) {
                throw new Error("A conflict dialogue opened for a waiting file which was already resolved elsewhere");
            }
            const waitingModal = conflictDialogue(page, waitingPath);
            await waitingModal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await waitingModal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
            await page.waitForFunction(
                () => (globalThis as ObsidianTestGlobal).__livesyncWaitingConflictCompleted === true,
                undefined,
                { timeout: uiTimeoutMs }
            );
            await page.waitForTimeout(250);
            if (await conflictDialogue(page, externallyResolvedWaitingPath).isVisible()) {
                throw new Error("A resolved waiting-file dialogue opened after the active dialogue completed");
            }
        });
        await waitForConflictChecks(cliBinary, session.cliEnv);

        await createTwoVersionConflict(cliBinary, session.cliEnv, unloadActivePath);
        const unloadWaitingFixture = await createTwoVersionConflict(cliBinary, session.cliEnv, unloadWaitingPath);
        await requestConflictCheck(cliBinary, session.cliEnv, false, unloadActivePath);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await conflictDialogue(page, unloadActivePath).waitFor({ state: "visible", timeout: uiTimeoutMs });
        });
        await requestInteractiveConflictResolution(
            cliBinary,
            session.cliEnv,
            unloadWaitingPath,
            unloadWaitingFixture,
            true
        );
        const beforeUnloadScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-before-unload.png",
            (page) => conflictDialogue(page, unloadActivePath).locator(".modal").first()
        );
        await disableLiveSyncAndWaitForConflictChecks(session.remoteDebuggingPort);
        const afterUnloadScreenshot = await captureObsidianPage(
            session.remoteDebuggingPort,
            "conflict-dialog-after-unload.png",
            async (page) => {
                await page.waitForTimeout(250);
                if (await conflictDialogue(page).isVisible()) {
                    throw new Error("A conflict dialogue remained visible after LiveSync was unloaded");
                }
                const pluginStillLoaded = await page.evaluate(
                    () => (globalThis as ObsidianTestGlobal).app?.plugins?.plugins?.["obsidian-livesync"] !== undefined
                );
                if (pluginStillLoaded) throw new Error("LiveSync remained loaded after disablePlugin completed");
            }
        );

        await enableLiveSync(session.remoteDebuggingPort);
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.waitForTimeout(500);
            if (await conflictDialogue(page).isVisible()) {
                throw new Error("A stale conflict dialogue reopened after LiveSync was enabled again");
            }
        });
        await createAndOpenBaseFile(cliBinary, session.cliEnv, unloadActivePath);
        await requestConflictCheck(cliBinary, session.cliEnv, false, unloadActivePath);
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await conflictDialogue(page, unloadActivePath).waitFor({ state: "visible", timeout: uiTimeoutMs });
        });
        const afterReloadScreenshot = await captureObsidianElement(
            session.remoteDebuggingPort,
            "conflict-dialog-after-reload.png",
            (page) => conflictDialogue(page, unloadActivePath).locator(".modal").first()
        );
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const modal = conflictDialogue(page, unloadActivePath);
            await modal.getByRole("button", { name: "Not now", exact: true }).click({ timeout: uiTimeoutMs });
            await modal.waitFor({ state: "hidden", timeout: uiTimeoutMs });
        });
        await waitForConflictChecks(cliBinary, session.cliEnv);

        console.log(
            "Real Obsidian preserved pairwise conflict resolution and dialogue presentation; replaced only stale same-file dialogues; serialised different files; discarded externally resolved waiting requests; and drained active and waiting requests across unload and reload."
        );
        console.log(`Dialogue screenshot: ${firstDialogueScreenshot}`);
        console.log(`Postponed warning screenshot: ${warningScreenshot}`);
        console.log(`Same-file replacement screenshot: ${repeatedDialogueScreenshot}`);
        console.log(`Different-file waiting screenshot: ${differentFileWaitingScreenshot}`);
        console.log(`Before unload screenshot: ${beforeUnloadScreenshot}`);
        console.log(`After unload screenshot: ${afterUnloadScreenshot}`);
        console.log(`After reload screenshot: ${afterReloadScreenshot}`);
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
