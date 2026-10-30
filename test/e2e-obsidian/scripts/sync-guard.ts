import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
    type CouchDbConfig,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { captureObsidianPage, withObsidianPage } from "../runner/ui.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

const observerKey = "__livesyncE2eSyncGuard";
const minimumFiles = 3;
const notes = Array.from({ length: 6 }, (_, index) => ({
    path: `E2E/sync-guard/incoming-${index}.md`,
    content: [
        `# Incoming SyncGuard note ${index}`,
        "",
        ...Array.from(
            { length: 6 },
            (_, paragraph) =>
                `Paragraph ${paragraph} of note ${index} travels through real CouchDB Metadata and Chunks.`
        ),
        "",
    ].join("\n"),
}));
const workspacePath = "local-workspace.md";
const workspaceContent = "# Local workspace\n\nLocal work can continue after bypass.\n";
const workspaceEdit = "Written after bypass.\n";

type GuardObservation = {
    phase: string;
    observedPhases: string[];
    finiteActivity: number;
    forwardedIds: string[];
    transferStoppedAt: number | null;
    reflectionHeld: boolean;
    storageApplying: number;
    parsing: number;
    reflecting: number;
    startError: string | null;
    visible: boolean;
    stage: string;
    count: string;
};

async function readObservation(cliBinary: string, env: NodeJS.ProcessEnv): Promise<GuardObservation> {
    return await evalObsidianJson<GuardObservation>(
        cliBinary,
        [
            "(()=>{",
            `const state=globalThis[${JSON.stringify(observerKey)}];`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const overlay=document.querySelector('.sls-sync-guard');",
            "return JSON.stringify({",
            "phase:core.services.replicator.replicationStatics.value.couchDB?.phase??'idle',",
            "observedPhases:state.observedPhases,finiteActivity:core.services.replicator.finiteReplicationActivityCount.value,",
            "forwardedIds:[...state.forwardedIds],transferStoppedAt:state.transferStoppedAt,",
            "reflectionHeld:state.reflectionHeld,storageApplying:core.services.replication.storageApplyingCount.value,",
            "parsing:state.parsing,reflecting:state.reflecting,startError:state.startError,",
            "visible:!!overlay&&overlay.getBoundingClientRect().width>0,",
            "stage:overlay?.querySelector('.sls-sync-guard-stage')?.textContent??'',",
            "count:overlay?.querySelector('.sls-sync-guard-count')?.textContent??'',",
            "});})()",
        ].join(""),
        env
    );
}

function assertCatchUpPending(state: GuardObservation): void {
    assertEqual(state.observedPhases.includes("catch-up"), true, "The provider never entered CouchDB catch-up.");
    assertEqual(
        state.observedPhases.includes("continuous"),
        false,
        "Catch-up completed before the held receive callback."
    );
    assertEqual(state.finiteActivity > 0, true, "The held receive callback lost its finite replication activity.");
    assertEqual(state.parsing > 0, true, "The real receive callback was no longer pending.");
    assertEqual(
        state.phase === "catch-up" || state.phase === "idle",
        true,
        `Unexpected phase while the finite catch-up still owns its receive callback: ${state.phase}`
    );
}

async function waitForObservation(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    description: string,
    predicate: (state: GuardObservation) => boolean
): Promise<GuardObservation> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_REMOTE_ACTIVITY_TIMEOUT_MS ?? 30000);
    let state: GuardObservation;
    do {
        state = await readObservation(cliBinary, env);
        if (state.startError) throw new Error(`Continuous replication failed: ${state.startError}`);
        if (predicate(state)) return state;
        await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`);
}

async function installGates(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    incomingEntries: LocalDatabaseEntry[]
): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        [
            "(()=>{",
            `const key=${JSON.stringify(observerKey)};`,
            "if(globalThis[key]) throw new Error('SyncGuard gates are already installed');",
            "const services=app.plugins.plugins['obsidian-livesync'].core.services;",
            "const replication=services.replication;",
            `const incomingIds=new Set(${JSON.stringify(incomingEntries.map((entry) => entry.id))});`,
            `const heldPath=${JSON.stringify(notes[0].path)};`,
            `const minimumFiles=${minimumFiles};`,
            "const state={forwardedIds:new Set(),transferStoppedAt:null,reflectionHeld:false,",
            "parsing:0,reflecting:0,startError:null,releases:[],restore:null,observedPhases:[]};",
            "const observePhase=()=>{const phase=services.replicator.replicationStatics.value.couchDB?.phase??'idle';",
            "if(state.observedPhases.at(-1)!==phase) state.observedPhases.push(phase);};",
            "services.replicator.replicationStatics.onChanged(observePhase);observePhase();",
            "const gate=()=>{let release;const promise=new Promise((resolve)=>{release=resolve;});",
            "state.releases.push(release);return {promise,release};};",
            "const below=gate(),threshold=gate(),reflection=gate();",
            "state.releaseBelow=below.release;state.releaseThreshold=threshold.release;state.releaseReflection=reflection.release;",
            "const originalParse=replication.parseSynchroniseResult;",
            "const originalReflect=replication.processSynchroniseResult;",
            // Forward only documents supplied by the real pull. Pausing its awaited
            // callback retains the provider's own catch-up lifetime and counters.
            "const parse=Object.assign(async(documents)=>{",
            "state.parsing++;try{let accepted=true;for(const document of documents){",
            "accepted=(await originalParse([document]))&&accepted;",
            "if(!incomingIds.has(document._id)||state.forwardedIds.has(document._id)) continue;",
            "state.forwardedIds.add(document._id);",
            "if(state.forwardedIds.size===minimumFiles-1){state.transferStoppedAt=minimumFiles-1;await below.promise;state.transferStoppedAt=null;}",
            "if(state.forwardedIds.size===minimumFiles){state.transferStoppedAt=minimumFiles;await threshold.promise;state.transferStoppedAt=null;}",
            "}return accepted;}finally{state.parsing--;}",
            "},originalParse);",
            // Result processing has already incremented storageApplyingCount when
            // this real reflection enters. The test never assigns queue counts.
            "const reflect=Object.assign(async(entry)=>{",
            "state.reflecting++;try{if(entry.path===heldPath){state.reflectionHeld=true;await reflection.promise;state.reflectionHeld=false;}",
            "return await originalReflect(entry);}finally{state.reflecting--;}",
            "},originalReflect);",
            "replication.parseSynchroniseResult=parse;replication.processSynchroniseResult=reflect;",
            "state.restore=()=>{",
            "services.replicator.replicationStatics.offChanged(observePhase);",
            "if(replication.parseSynchroniseResult===parse) replication.parseSynchroniseResult=originalParse;",
            "if(replication.processSynchroniseResult===reflect) replication.processSynchroniseResult=originalReflect;",
            "for(const release of state.releases) release();};",
            "globalThis[key]=state;return JSON.stringify(true);})()",
        ].join(""),
        env
    );
}

async function releaseGate(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    gate: "Below" | "Threshold" | "Reflection"
): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        `(()=>{globalThis[${JSON.stringify(observerKey)}].release${gate}();return JSON.stringify(true);})()`,
        env
    );
}

async function removeGates(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        `(()=>{globalThis[${JSON.stringify(observerKey)}]?.restore();return JSON.stringify(true);})()`,
        env
    );
    await waitForObservation(
        cliBinary,
        env,
        "released receive and reflection hooks",
        (state) => state.parsing === 0 && state.reflecting === 0
    );
    await evalObsidianJson(
        cliBinary,
        `(()=>{delete globalThis[${JSON.stringify(observerKey)}];return JSON.stringify(true);})()`,
        env
    );
}

async function startCatchUp(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.setting.setSyncGuardSetting('syncGuardEnabled',true);",
            `await core.services.setting.setSyncGuardSetting('syncGuardMinimumFiles',${minimumFiles});`,
            `const state=globalThis[${JSON.stringify(observerKey)}];`,
            "state.startTask=(async()=>{",
            "await core.services.setting.applyExternalSettings({liveSync:true},true);",
            "await core.services.control.applySettings();",
            "})().catch((error)=>{state.startError=String(error);});",
            "return JSON.stringify(core.services.setting.syncGuardSettings);})()",
        ].join(""),
        env
    );
}

async function assertVaultPathMissing(vault: TemporaryVault, path: string): Promise<void> {
    try {
        await readFile(join(vault.path, path), "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
    }
    throw new Error(`The held reflection wrote its Vault note before release: ${path}`);
}

async function waitForVaultContent(vault: TemporaryVault, path: string, expected: string): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 15000);
    let actual: string | null = null;
    do {
        try {
            actual = await readFile(join(vault.path, path), "utf8");
            if (actual === expected) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(`Vault content did not converge for ${path}: ${JSON.stringify(actual)}`);
}

async function assertIncomingContents(cliBinary: string, env: NodeJS.ProcessEnv, vault: TemporaryVault): Promise<void> {
    for (const note of notes) await waitForVaultContent(vault, note.path, note.content);
    const contents = await evalObsidianJson<string[]>(
        cliBinary,
        `(async()=>{const paths=${JSON.stringify(notes.map((note) => note.path))};return JSON.stringify(await Promise.all(paths.map(async(path)=>{const file=app.vault.getAbstractFileByPath(path);return file?await app.vault.read(file):null;})));})()`,
        env
    );
    notes.forEach((note, index) =>
        assertEqual(contents[index], note.content, `Obsidian read back incorrect content at ${note.path}.`)
    );
}

async function createWorkspaceNote(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        `(async()=>{const file=await app.vault.create(${JSON.stringify(workspacePath)},${JSON.stringify(workspaceContent)});const leaf=app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source'}});leaf.view.editor.focus();return JSON.stringify(true);})()`,
        env
    );
}

async function runTarget(
    binary: string,
    cliBinary: string,
    couchDb: CouchDbConfig,
    dbName: string,
    incomingEntries: LocalDatabaseEntry[],
    bypass: boolean
): Promise<void> {
    const label = bypass ? "bypass" : "automatic";
    const vault = await createTemporaryVault(`obsidian-livesync-sync-guard-${label}-`);
    let session: ObsidianLiveSyncSession | undefined;
    try {
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            pluginData: createE2eCouchDbPluginData({ ...couchDb, dbName }),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        const { cliEnv } = session;
        await waitForLiveSyncCoreReady(cliBinary, cliEnv);
        await prepareRemote(cliBinary, cliEnv);
        if (bypass) await createWorkspaceNote(cliBinary, cliEnv);
        await installGates(cliBinary, cliEnv, incomingEntries);
        await startCatchUp(cliBinary, cliEnv);

        const below = await waitForObservation(
            cliBinary,
            cliEnv,
            "real incoming notes below the threshold",
            (state) => state.transferStoppedAt === minimumFiles - 1
        );
        assertCatchUpPending(below);
        assertEqual(below.forwardedIds.length, minimumFiles - 1, "Unexpected incoming note count below the threshold.");
        assertEqual(below.visible, false, "SyncGuard blocked the workspace before the configured threshold.");
        await releaseGate(cliBinary, cliEnv, "Below");

        const threshold = await waitForObservation(
            cliBinary,
            cliEnv,
            "SyncGuard at the configured threshold",
            (state) => state.transferStoppedAt === minimumFiles && state.visible
        );
        assertCatchUpPending(threshold);
        assertEqual(
            threshold.forwardedIds.length,
            minimumFiles,
            "SyncGuard did not activate at the configured threshold."
        );
        assertEqual(
            threshold.count,
            `At least ${minimumFiles} changed files received`,
            "SyncGuard showed an incorrect received-file count."
        );
        assertEqual(threshold.stage, "Receiving changes from the server…", "SyncGuard did not show transfer progress.");
        console.log(
            await captureObsidianPage(
                session.remoteDebuggingPort,
                `sync-guard-${label}-threshold.png`,
                async (page) => {
                    await page
                        .getByRole("button", { name: "Continue without waiting", exact: true })
                        .waitFor({ state: "visible" });
                }
            )
        );

        if (bypass) {
            const editorFocused = await evalObsidianJson<boolean>(
                cliBinary,
                "(()=>{const editor=app.workspace.activeLeaf.view.editor;editor.focus();return JSON.stringify(editor.hasFocus());})()",
                cliEnv
            );
            assertEqual(editorFocused, true, "The guarded keyboard check did not focus the editor.");
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                await page.keyboard.type("This input must stay blocked.");
            });
            const guardedContent = await evalObsidianJson<string>(
                cliBinary,
                "(()=>JSON.stringify(app.workspace.activeLeaf.view.editor.getValue()))()",
                cliEnv
            );
            assertEqual(guardedContent, workspaceContent, "The protected editor accepted keyboard input.");
            await withObsidianPage(session.remoteDebuggingPort, async (page) => {
                await page.getByRole("button", { name: "Continue without waiting", exact: true }).click();
                await page.locator(".sls-sync-guard").waitFor({ state: "hidden" });
                const editor = page.locator(".workspace-leaf.mod-active .cm-content");
                await editor.click();
                await page.keyboard.press("ControlOrMeta+End");
                await page.keyboard.type(workspaceEdit);
            });
            await waitForVaultContent(vault, workspacePath, workspaceContent + workspaceEdit);
            const continuing = await readObservation(cliBinary, cliEnv);
            assertCatchUpPending(continuing);
            assertEqual(
                continuing.transferStoppedAt,
                minimumFiles,
                "The receive callback was not pending during bypass."
            );
            assertEqual(continuing.visible, false, "The bypass did not restore the workspace.");
            await releaseGate(cliBinary, cliEnv, "Threshold");
            await waitForObservation(
                cliBinary,
                cliEnv,
                "continuous replication after bypass",
                (state) => state.phase === "continuous" && state.reflectionHeld
            );
            await assertVaultPathMissing(vault, notes[0].path);
            assertEqual(
                (await readObservation(cliBinary, cliEnv)).visible,
                false,
                "The guard reopened during the bypassed catch-up."
            );
        } else {
            await releaseGate(cliBinary, cliEnv, "Threshold");
            const applying = await waitForObservation(
                cliBinary,
                cliEnv,
                "network completion with a held Vault reflection",
                (state) => state.phase === "continuous" && state.reflectionHeld && state.storageApplying > 0
            );
            assertEqual(
                applying.forwardedIds.length,
                notes.length,
                "The real catch-up did not deliver every incoming note."
            );
            assertEqual(applying.visible, true, "SyncGuard released before the held Vault reflection finished.");
            assertEqual(
                applying.stage,
                "Applying received changes to local notes…",
                "SyncGuard did not show local application progress."
            );
            await assertVaultPathMissing(vault, notes[0].path);
            // Exceed the guard's ordinary quiet period while real application work remains pending.
            await new Promise((resolve) => setTimeout(resolve, 2500));
            const stillApplying = await readObservation(cliBinary, cliEnv);
            assertEqual(stillApplying.visible, true, "SyncGuard released while real reflection was still pending.");
            assertEqual(stillApplying.reflectionHeld, true, "The reflection gate was released unexpectedly.");
            console.log(
                await captureObsidianPage(session.remoteDebuggingPort, "sync-guard-applying.png", async (page) => {
                    await page.locator(".sls-sync-guard").waitFor({ state: "visible" });
                })
            );
        }

        await releaseGate(cliBinary, cliEnv, "Reflection");
        await assertIncomingContents(cliBinary, cliEnv, vault);
        await waitForObservation(
            cliBinary,
            cliEnv,
            "workspace release after exact Vault reflection",
            (state) => !state.visible && state.phase === "continuous" && state.storageApplying === 0
        );
        if (bypass) await waitForVaultContent(vault, workspacePath, workspaceContent + workspaceEdit);
        console.log(
            `SyncGuard ${label}: threshold ${minimumFiles}, ${notes.length} exact incoming notes, workspace released.`
        );
    } catch (error) {
        if (session) {
            await captureObsidianPage(
                session.remoteDebuggingPort,
                `sync-guard-${label}-failure.png`,
                async () => {}
            ).catch(() => undefined);
            const observation = await readObservation(cliBinary, session.cliEnv).catch(() => null);
            console.error(`SyncGuard ${label} failure state: ${JSON.stringify(observation)}`);
        }
        throw error;
    } finally {
        if (session) {
            await removeGates(cliBinary, session.cliEnv).catch((error: unknown) => {
                console.warn(`SyncGuard hook cleanup: ${error instanceof Error ? error.message : String(error)}`);
            });
            await session.app.stop();
        }
        await vault.dispose();
    }
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "sync-guard");
    const sourceVault = await createTemporaryVault("obsidian-livesync-sync-guard-source-");
    let source: ObsidianLiveSyncSession | undefined;
    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        source = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault: sourceVault,
            pluginData: createE2eCouchDbPluginData({ ...couchDb, dbName }),
            localStorageEntries: createE2eObsidianDeviceLocalState(sourceVault.name),
        });
        await waitForLiveSyncCoreReady(cli.binary, source.cliEnv);
        await prepareRemote(cli.binary, source.cliEnv);
        await evalObsidianJson(
            cli.binary,
            `(async()=>{const notes=${JSON.stringify(notes)};await app.vault.createFolder('E2E');await app.vault.createFolder('E2E/sync-guard');for(const note of notes){const file=await app.vault.create(note.path,note.content);if(await app.vault.read(file)!==note.content) throw new Error('Source note read-back failed');}return JSON.stringify(true);})()`,
            source.cliEnv
        );
        const entries: LocalDatabaseEntry[] = [];
        for (const note of notes) entries.push(await waitForLocalDatabaseEntry(cli.binary, source.cliEnv, note.path));
        if (entries.some((entry) => entry.children.length === 0))
            throw new Error("Source notes did not produce real Chunks.");
        await pushLocalChanges(cli.binary, source.cliEnv);
        await waitForCouchDbDocs(couchDb, dbName, (documents) => {
            const ids = new Set(documents.map((document) => document._id));
            return entries.every((entry) => ids.has(entry.id) && entry.children.every((id) => ids.has(id)));
        });
        await source.app.stop();
        source = undefined;

        await runTarget(binary, cli.binary, couchDb, dbName, entries, false);
        await runTarget(binary, cli.binary, couchDb, dbName, entries, true);
    } finally {
        if (source) await source.app.stop();
        await sourceVault.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") await deleteCouchDbDatabase(couchDb, dbName);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
