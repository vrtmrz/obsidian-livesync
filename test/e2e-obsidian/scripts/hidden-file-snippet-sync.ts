import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { decodeBinary } from "octagonal-wheels/binary";
import { VERSIONING_DOCID } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ENCRYPTED_INTERNAL_METADATA_FEATURE, REMOTE_FEATURE_GENERATION } from "@vrtmrz/livesync-commonlib/replication";
import {
    assertLocatorHasMinimumTouchTarget,
    assertLocatorWithinSafeArea,
    assertLocatorWithinViewport,
    assertNoHorizontalOverflow,
} from "@vrtmrz/obsidian-test-session";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
    type CouchDbConfig,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    assertE2eCompatibilityMarker,
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import {
    captureObsidianPage,
    captureJsonResolveDialogue,
    clickJsonResolveOption,
    obsidianRemoteDebuggingPort,
    openLiveSyncSettings,
    withObsidianPage,
} from "../runner/ui.ts";
import { iPhoneSafeArea, setObsidianMobileTestMode } from "../runner/mobileUi.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "20000";

const snippetPath = ".obsidian/snippets/livesync-e2e.css";
const snippetContent = [
    "body {",
    "    --livesync-e2e-snippet-colour: #245a70;",
    "}",
    "",
    ".livesync-e2e-snippet {",
    "    color: var(--livesync-e2e-snippet-colour);",
    "}",
    "",
].join("\n");

const mergeJsonPath = ".obsidian/livesync-e2e-merge.json";
const manualMergeJsonPath = ".obsidian/livesync-e2e-manual-merge.json";
const replacementMergeJsonPath = ".obsidian/livesync-e2e-manual-replacement.json";
const externalResolutionTargetPath = ".obsidian/livesync-e2e-external-resolution.json";
const externalResolutionUnrelatedPath = ".obsidian/livesync-e2e-external-unrelated.json";
const hiddenConflictStateKey = "__livesyncE2EHiddenConflictResolution";
const hiddenConflictComparisonStateKey = "__livesyncE2EHiddenConflictComparison";
const hiddenConflictModalStateKey = "__livesyncE2EHiddenConflictModal";
const targetPath = ".obsidian/livesync-targeted/only-a.json";
const hiddenFileCliTimeoutMs = Number(process.env.E2E_OBSIDIAN_HIDDEN_FILE_CLI_TIMEOUT_MS ?? 90000);
const hiddenFileInitialisationStateKey = "__livesyncE2EHiddenFileInitialisation";
const disabledInitialisationProbeKey = "__livesyncE2EDisabledHiddenInitialisation";

type DisabledInitialisationSnapshot = {
    syncInternalFiles: boolean;
    hiddenFiles: { id: string; path: string; rev: string; deleted: boolean }[];
    processedFiles: [string, string | undefined][];
    processedDatabaseFiles: [string, string | undefined][];
};

type DisabledInitialisationObservation = {
    result: boolean | null;
    before: DisabledInitialisationSnapshot;
    after: DisabledInitialisationSnapshot;
    progressNotices: string[];
};

type RunnerContext = {
    binary: string;
    cliBinary: string;
    couchDb: CouchDbConfig;
    dbName: string;
    activeSessions: Set<ObsidianLiveSyncSession>;
    temporaryVaults: Set<TemporaryVault>;
    diagnosticPaths: string[];
};

async function writeVaultFile(vaultPath: string, path: string, content: string): Promise<void> {
    const fullPath = join(vaultPath, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
}

async function removeVaultFile(vaultPath: string, path: string): Promise<void> {
    await rm(join(vaultPath, path), { force: true });
}

async function readVaultFile(vaultPath: string, path: string): Promise<string> {
    return await readFile(join(vaultPath, path), "utf-8");
}

async function pathExists(vaultPath: string, path: string): Promise<boolean> {
    try {
        await readFile(join(vaultPath, path));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function waitForPathContent(
    vaultPath: string,
    path: string,
    predicate: (content: string) => boolean,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000)
): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let lastContent = "";
    while (Date.now() < deadline) {
        if (await pathExists(vaultPath, path)) {
            lastContent = await readVaultFile(vaultPath, path);
            if (predicate(lastContent)) {
                return lastContent;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}. Last content:\n${lastContent}`);
}

async function waitForPathDeleted(
    vaultPath: string,
    path: string,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 10000)
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!(await pathExists(vaultPath, path))) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for deleted file: ${join(vaultPath, path)}`);
}

async function assertDisabledInitialisationIsNoOp(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    vault: TemporaryVault
): Promise<void> {
    const snippetExisted = await pathExists(vault.path, snippetPath);
    const originalSnippet = snippetExisted ? await readVaultFile(vault.path, snippetPath) : undefined;
    const originalJson = await readVaultFile(vault.path, mergeJsonPath);
    const preservedSnippet = "body { --disabled-hidden-initialisation: preserved; }\n";
    const preservedJson = JSON.stringify({ disabledInitialisation: "preserved" }, null, 4) + "\n";
    await writeVaultFile(vault.path, snippetPath, preservedSnippet);
    await writeVaultFile(vault.path, mergeJsonPath, preservedJson);

    try {
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            await page.evaluate((stateKey) => {
                const state = { progressNotices: [] as string[] };
                const observer = new MutationObserver(() => {
                    for (const notice of document.querySelectorAll<HTMLElement>(".notice")) {
                        const text = notice.textContent?.trim() ?? "";
                        if (text.includes("[⚙") && !state.progressNotices.includes(text)) {
                            state.progressNotices.push(text);
                        }
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true, characterData: true });
                (globalThis as unknown as Record<string, { progressNotices: string[]; observer: MutationObserver }>)[
                    stateKey
                ] = { ...state, observer };
            }, disabledInitialisationProbeKey);
        });

        const observation = await evalObsidianJson<DisabledInitialisationObservation>(
            context.cliBinary,
            [
                "(async()=>{",
                `const targetFiles=${JSON.stringify([snippetPath, mergeJsonPath])};`,
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const addOn=core.getAddOn('HiddenFileSync');",
                "const snapshot=async()=>{",
                "const files=await addOn.getAllDatabaseFiles();",
                "const markers=(cache)=>Array.from(cache.keys()).sort().map((path)=>[path,cache.get(path)]);",
                "return {",
                "syncInternalFiles:core.settings.syncInternalFiles,",
                "hiddenFiles:files.map((entry)=>({id:entry._id,path:addOn.getPath(entry),rev:entry._rev??'',deleted:!!(entry.deleted||entry._deleted)})).sort((a,b)=>a.path.localeCompare(b.path)),",
                "processedFiles:markers(addOn._fileInfoLastProcessed),",
                "processedDatabaseFiles:markers(addOn._databaseInfoLastProcessed),",
                "};};",
                "const before=await snapshot();",
                "const result=await addOn.initialiseInternalFileSync('pullForce',true,targetFiles);",
                "const after=await snapshot();",
                "return JSON.stringify({result:result===undefined?null:result,before,after});",
                "})()",
            ].join(""),
            session.cliEnv,
            hiddenFileCliTimeoutMs
        );
        const progressNotices = await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            return await page.evaluate((stateKey) => {
                const state = (
                    globalThis as unknown as Record<
                        string,
                        { progressNotices: string[]; observer: MutationObserver } | undefined
                    >
                )[stateKey];
                state?.observer.disconnect();
                return state?.progressNotices ?? [];
            }, disabledInitialisationProbeKey);
        });

        const failures: string[] = [];
        if (observation.result !== false)
            failures.push(`expected false result, received ${String(observation.result)}`);
        if (observation.before.syncInternalFiles !== false || observation.after.syncInternalFiles !== false) {
            failures.push("Hidden File Sync setting changed while initialisation was disabled");
        }
        if (JSON.stringify(observation.before) !== JSON.stringify(observation.after)) {
            failures.push("local hidden database state or processed markers changed");
        }
        if ((await readVaultFile(vault.path, snippetPath)) !== preservedSnippet) {
            failures.push("the existing local snippet was deleted or replaced");
        }
        if ((await readVaultFile(vault.path, mergeJsonPath)) !== preservedJson) {
            failures.push("the existing local JSON file was replaced");
        }
        if (progressNotices.length > 0)
            failures.push(`initialisation created progress Notices: ${JSON.stringify(progressNotices)}`);
        if (failures.length > 0) {
            throw new Error(
                `Disabled Hidden File Sync initialisation was not a no-op: ${failures.join("; ")}\n${JSON.stringify({
                    observation,
                    progressNotices,
                })}`
            );
        }
        console.log(
            "Disabled Hidden File Sync initialisation returned false without changing hidden files or cached state."
        );
    } finally {
        await writeVaultFile(vault.path, mergeJsonPath, originalJson);
        if (snippetExisted && originalSnippet !== undefined) {
            await writeVaultFile(vault.path, snippetPath, originalSnippet);
        } else {
            await removeVaultFile(vault.path, snippetPath);
        }
    }
}

function hasJsonValues(content: string, values: Record<string, unknown>): boolean {
    try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        return Object.entries(values).every(([key, value]) => parsed[key] === value);
    } catch {
        return false;
    }
}

async function scanHiddenStorage(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "await addOn.scanAllStorageChanges(true);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function scanHiddenDatabase(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "await addOn.scanAllDatabaseChanges(true);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env,
        hiddenFileCliTimeoutMs
    );
}

async function resolveHiddenConflicts(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "await addOn.resolveConflictOnInternalFiles();",
            "await addOn.scanAllDatabaseChanges(true);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env,
        hiddenFileCliTimeoutMs
    );
}

async function startHiddenConflictResolution(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        [
            "(()=>{",
            `const key=${JSON.stringify(hiddenConflictStateKey)};`,
            "const state={done:false,error:null};",
            "globalThis[key]=state;",
            `const comparison=globalThis[${JSON.stringify(hiddenConflictComparisonStateKey)}];`,
            "if(comparison)comparison.operation=state;",
            "const addOn=app.plugins.plugins['obsidian-livesync'].core.getAddOn('HiddenFileSync');",
            "void addOn.resolveConflictOnInternalFiles().then(",
            "()=>{state.done=true;},",
            "error=>{state.error=String(error);state.done=true;}",
            ");",
            "return JSON.stringify({started:true});",
            "})()",
        ].join(""),
        env
    );
}

type HiddenJsonComparisonCall = {
    leftRev: string | null;
    rightRev: string | null;
    done: boolean;
    result: unknown;
    error: string | null;
};

type HiddenJsonComparisonObservation = {
    pipelineDone: boolean;
    calls: HiddenJsonComparisonCall[];
};

async function installHiddenJsonComparisonObserver(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(()=>{",
            `const key=${JSON.stringify(hiddenConflictComparisonStateKey)};`,
            "const addOn=app.plugins.plugins['obsidian-livesync'].core.getAddOn('HiddenFileSync');",
            "const original=addOn.showJSONMergeDialogAndMerge;",
            "if(typeof original!=='function')throw new Error('Hidden File Sync JSON comparison method is unavailable');",
            "const state={calls:[],original,operation:null};",
            "state.wrapper=function(left,right){",
            "const call={leftRev:left?._rev??null,rightRev:right?._rev??null,done:false,result:null,error:null};",
            "state.calls.push(call);",
            "const result=state.original.call(this,left,right);",
            "Promise.resolve(result).then(value=>{call.done=true;call.result=typeof value==='boolean'||value===null?value:String(value);},error=>{call.done=true;call.error=String(error);});",
            "return result;};",
            "addOn.showJSONMergeDialogAndMerge=state.wrapper;",
            "globalThis[key]=state;return JSON.stringify({installed:true});",
            "})()",
        ].join(""),
        env
    );
}

async function readHiddenJsonComparisonObservation(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<HiddenJsonComparisonObservation> {
    return await evalObsidianJson<HiddenJsonComparisonObservation>(
        cliBinary,
        [
            "(()=>{",
            `const state=globalThis[${JSON.stringify(hiddenConflictComparisonStateKey)}];`,
            "const operation=state?.operation;",
            "if(!state||!operation)throw new Error('Hidden JSON comparison observation is unavailable');",
            "return JSON.stringify({pipelineDone:operation.done,calls:state.calls});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForHiddenConflictResolution(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson(
        cliBinary,
        [
            "(async()=>{",
            `const key=${JSON.stringify(hiddenConflictStateKey)};`,
            "const state=globalThis[key];",
            "if(!state)throw new Error('Hidden conflict resolution was not started');",
            "const deadline=Date.now()+60000;",
            "while(!state.done&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));",
            "if(!state.done)throw new Error('Hidden conflict pipeline did not complete');",
            "if(state.error)throw new Error(state.error);",
            "delete globalThis[key];",
            "return JSON.stringify({done:true});",
            "})()",
        ].join(""),
        env,
        hiddenFileCliTimeoutMs
    );
}

async function assertResolvedHiddenContent(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    expectedContent: string
): Promise<void> {
    const stored = await evalObsidianJson<{
        rev: string;
        currentRev: string;
        conflicts: string[];
        datatype: string;
        data: string | string[];
    }>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase;",
            "const entry=await db.getDBEntry(`i:${path}`);",
            "if(!entry)throw new Error(`Resolved hidden file is missing: ${path}`);",
            "const current=await db.getRaw(entry._id,{conflicts:true});",
            "return JSON.stringify({rev:entry._rev,currentRev:current._rev,conflicts:current._conflicts||[],datatype:entry.datatype,data:entry.data});",
            "})()",
        ].join(""),
        env
    );
    assertEqual(stored.rev, stored.currentRev, `Hidden result changed while reading ${path}.`);
    assertEqual(stored.conflicts.length, 0, `Hidden conflict remains for ${path}.`);
    const content =
        stored.datatype === "plain"
            ? typeof stored.data === "string"
                ? stored.data
                : stored.data.join("")
            : new TextDecoder().decode(decodeBinary(stored.data));
    assertEqual(content, expectedContent, `Stored hidden content differs from the Vault file: ${path}.`);
}

type HiddenConflictLeaf = {
    rev: string;
    datatype: string;
    data: string | string[];
};

async function readHiddenConflictLeaves(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string
): Promise<{ currentRev: string; conflictRevs: string[]; leaves: HiddenConflictLeaf[] }> {
    return await evalObsidianJson<{
        currentRev: string;
        conflictRevs: string[];
        leaves: HiddenConflictLeaf[];
    }>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase;",
            "const entry=await db.getDBEntry(`i:${path}`);",
            "if(!entry)throw new Error(`Hidden conflict entry is missing: ${path}`);",
            "const current=await db.getRaw(entry._id,{conflicts:true});",
            "const conflictRevs=current._conflicts||[];",
            "const leaves=await Promise.all([current._rev,...conflictRevs].map(async rev=>{",
            "const doc=await db.getDBEntry(`i:${path}`,{rev},false,true,true);",
            "if(!doc)throw new Error(`Could not load hidden conflict revision ${rev}: ${path}`);",
            "return {rev:doc._rev,datatype:doc.datatype,data:doc.data};}));",
            "if(leaves.some(leaf=>!leaf.datatype||leaf.data===undefined))throw new Error(`Could not read every hidden conflict leaf: ${path}`);",
            "return JSON.stringify({currentRev:current._rev,conflictRevs,leaves});",
            "})()",
        ].join(""),
        env
    );
}

function decodeHiddenConflictLeaf(leaf: HiddenConflictLeaf): string {
    return leaf.datatype === "plain"
        ? typeof leaf.data === "string"
            ? leaf.data
            : leaf.data.join("")
        : new TextDecoder().decode(decodeBinary(leaf.data));
}

async function storeHiddenFileAsConflict(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    baseRev: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const baseRev=${JSON.stringify(baseRev)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "const fileInfo=await addOn.loadFileWithInfo(path);",
            "if(fileInfo.deleted) throw new Error(`Hidden file was unexpectedly deleted: ${path}`);",
            "const baseData=await addOn.__loadBaseSaveData(path,true);",
            "if(baseData===false) throw new Error(`Could not load base save data: ${path}`);",
            "const saveData={",
            "  ...baseData,",
            "  data:fileInfo.body,",
            "  mtime:fileInfo.stat.mtime,",
            "  ctime:fileInfo.stat.ctime,",
            "  size:fileInfo.stat.size,",
            "  children:[],",
            "  deleted:false,",
            "  type:baseData.datatype,",
            "};",
            "const result=await core.localDatabase.putDBEntry(saveData,false,baseRev);",
            "if(!result?.ok) throw new Error(`Could not store conflicted hidden file: ${path}`);",
            "return JSON.stringify({ok:true,rev:result.rev});",
            "})()",
        ].join(""),
        env
    );
}

async function createHiddenJsonConflict(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    vault: TemporaryVault,
    path: string,
    base: string,
    left: string,
    right: string
): Promise<void> {
    await writeVaultFile(vault.path, path, base);
    await scanHiddenStorage(context.cliBinary, session.cliEnv);
    const baseEntry = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path, { hidden: true });

    await writeVaultFile(vault.path, path, left);
    await scanHiddenStorage(context.cliBinary, session.cliEnv);
    await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path, { hidden: true });

    await writeVaultFile(vault.path, path, right);
    await storeHiddenFileAsConflict(context.cliBinary, session.cliEnv, path, baseEntry.rev);
    const conflicts = await evalObsidianJson<number>(
        context.cliBinary,
        `(async()=>{
        const entry=await app.plugins.plugins['obsidian-livesync'].core.localDatabase.getDBEntryMeta(${JSON.stringify(`i:${path}`)},{conflicts:true});
        return JSON.stringify(entry?entry._conflicts?.length||0:0);
    })()`,
        session.cliEnv
    );
    assertEqual(conflicts, 1, "The hidden conflict fixture did not retain two live revisions.");
}

async function startConfiguredSession(
    context: RunnerContext,
    vault: TemporaryVault,
    overrides: Record<string, unknown> = {}
): Promise<ObsidianLiveSyncSession> {
    const couchDbSettings = {
        uri: context.couchDb.uri,
        username: context.couchDb.username,
        password: context.couchDb.password,
        dbName: context.dbName,
    };
    const hiddenFileSettings = {
        encrypt: true,
        passphrase: "internal-metadata-e2e-secret",
        usePathObfuscation: true,
        encryptInternalMetadata: true,
        syncInternalFiles: true,
        syncInternalFilesBeforeReplication: true,
        watchInternalFileChanges: false,
        syncInternalFilesTargetPatterns: "",
        ...overrides,
    };
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        // A fresh Vault waits for onboarding before opening its local database.
        // Seed the same isolated settings used by configureCouchDb so that the
        // application lifecycle can become ready without a user interaction.
        pluginData: createE2eCouchDbPluginData(couchDbSettings, hiddenFileSettings),
        localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
    });
    context.activeSessions.add(session);
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await assertE2eCompatibilityMarker(context.cliBinary, session.cliEnv);
    await configureCouchDb(context.cliBinary, session.cliEnv, couchDbSettings, hiddenFileSettings);
    await prepareRemote(context.cliBinary, session.cliEnv);
    return session;
}

async function stopSession(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function uploadHiddenFile(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    path: string
): Promise<LocalDatabaseEntry> {
    await scanHiddenStorage(context.cliBinary, session.cliEnv);
    const entry = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path, { hidden: true });
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) => {
        const ids = new Set(docs.map((doc) => doc._id));
        return ids.has(entry.id) && entry.children.every((childId) => ids.has(childId));
    });
    const remoteEntry = await fetchCouchDbDocument(context.couchDb, context.dbName, entry.id);
    if (
        !remoteEntry.path?.startsWith("/\\:") ||
        remoteEntry.children?.length !== 0 ||
        remoteEntry.ctime !== 0 ||
        remoteEntry.mtime !== 0 ||
        remoteEntry.size !== 0
    ) {
        throw new Error(`Hidden File Sync Metadata was not encrypted for ${entry.id}.`);
    }
    const versionInfo = await fetchCouchDbDocument(context.couchDb, context.dbName, VERSIONING_DOCID);
    if (
        versionInfo.version !== REMOTE_FEATURE_GENERATION ||
        !(versionInfo.used_features as unknown[] | undefined)?.includes(ENCRYPTED_INTERNAL_METADATA_FEATURE)
    ) {
        throw new Error("The remote feature list does not declare encrypted internal Metadata.");
    }
    return entry;
}

async function pullAndApplyHiddenFiles(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    options: { resolveConflicts?: boolean } = {}
): Promise<void> {
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    if (options.resolveConflicts === true) {
        await resolveHiddenConflicts(context.cliBinary, session.cliEnv);
    }
    await scanHiddenDatabase(context.cliBinary, session.cliEnv);
}

async function runCreateRoundTrip(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    await writeVaultFile(vaultA.path, snippetPath, snippetContent);
    let session = await startConfiguredSession(context, vaultA);
    const entry = await uploadHiddenFile(context, session, snippetPath);
    await evalObsidianJson(
        context.cliBinary,
        [
            "(async()=>{",
            "const rebuilder=app.plugins.plugins['obsidian-livesync'].core.rebuilder;",
            "const inform=rebuilder.informOptionalFeatures;",
            "rebuilder.informOptionalFeatures=async()=>{};",
            "try{await rebuilder.$rebuildRemote();}finally{rebuilder.informOptionalFeatures=inform;}",
            "return JSON.stringify(true);",
            "})()",
        ].join(""),
        session.cliEnv
    );
    const rebuiltVersion = await fetchCouchDbDocument(context.couchDb, context.dbName, VERSIONING_DOCID);
    const rebuiltEntry = await fetchCouchDbDocument(context.couchDb, context.dbName, entry.id);
    if (
        rebuiltVersion.version !== REMOTE_FEATURE_GENERATION ||
        !(rebuiltVersion.used_features as unknown[] | undefined)?.includes(ENCRYPTED_INTERNAL_METADATA_FEATURE) ||
        !rebuiltEntry.path?.startsWith("/\\:")
    ) {
        throw new Error("Remote Rebuild did not declare and encrypt internal Metadata for its accepted writer.");
    }
    console.log("Remote Rebuild declared the feature and preserved encrypted Hidden File Sync Metadata.");
    await stopSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await pullAndApplyHiddenFiles(context, session);
    const received = await waitForPathContent(vaultB.path, snippetPath, (content) => content === snippetContent);
    await stopSession(context, session);

    assertEqual(received, snippetContent, "Hidden snippet content did not round-trip to the second vault.");
    console.log(`Hidden create round-trip copied ${entry.id} to the second vault.`);
}

async function runDeleteRoundTrip(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    await removeVaultFile(vaultA.path, snippetPath);
    let session = await startConfiguredSession(context, vaultA);
    await scanHiddenStorage(context.cliBinary, session.cliEnv);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await pullAndApplyHiddenFiles(context, session);
    await waitForPathDeleted(vaultB.path, snippetPath);
    await stopSession(context, session);

    console.log("Hidden delete round-trip removed the snippet from the second vault.");
}

async function runJsonConflictRoundTrip(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const base = JSON.stringify({ base: true, fromA: false, fromB: false }, null, 4) + "\n";
    const left = JSON.stringify({ base: true, fromA: true, fromB: false }, null, 4) + "\n";
    const right = JSON.stringify({ base: true, fromA: false, fromB: true }, null, 4) + "\n";

    let session = await startConfiguredSession(context, vaultB);
    await createHiddenJsonConflict(context, session, vaultB, mergeJsonPath, base, left, right);
    await resolveHiddenConflicts(context.cliBinary, session.cliEnv);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    const mergedOnB = await waitForPathContent(vaultB.path, mergeJsonPath, (content) =>
        hasJsonValues(content, { fromA: true, fromB: true })
    );
    await assertResolvedHiddenContent(context.cliBinary, session.cliEnv, mergeJsonPath, mergedOnB);
    await stopSession(context, session);

    session = await startConfiguredSession(context, vaultA);
    await pullAndApplyHiddenFiles(context, session);
    const mergedOnA = await waitForPathContent(vaultA.path, mergeJsonPath, (content) =>
        hasJsonValues(content, { fromA: true, fromB: true })
    );
    await assertResolvedHiddenContent(context.cliBinary, session.cliEnv, mergeJsonPath, mergedOnA);
    await stopSession(context, session);

    assertEqual(mergedOnA, mergedOnB, "Merged hidden JSON content was not consistent across both vaults.");
    console.log("Hidden JSON conflict was automatically merged and round-tripped.");
}

async function runJsonManualConflictResolution(context: RunnerContext, vault: TemporaryVault): Promise<void> {
    const base = JSON.stringify({ shared: "base" }, null, 4) + "\n";
    const left = JSON.stringify({ shared: "left", fromA: true }, null, 4) + "\n";
    const right = JSON.stringify({ shared: "right", fromB: true }, null, 4) + "\n";

    const session = await startConfiguredSession(context, vault);
    await createHiddenJsonConflict(context, session, vault, manualMergeJsonPath, base, left, right);
    await startHiddenConflictResolution(context.cliBinary, session.cliEnv);
    const screenshotPath = await captureJsonResolveDialogue(obsidianRemoteDebuggingPort());
    const completedBeforeSelection = await evalObsidianJson<boolean>(
        context.cliBinary,
        `JSON.stringify(globalThis[${JSON.stringify(hiddenConflictStateKey)}].done)`,
        session.cliEnv
    );
    assertEqual(completedBeforeSelection, false, "The hidden conflict pipeline completed before selection.");
    await clickJsonResolveOption(obsidianRemoteDebuggingPort(), "AB");
    await waitForHiddenConflictResolution(context.cliBinary, session.cliEnv);

    const merged = await waitForPathContent(vault.path, manualMergeJsonPath, (content) =>
        hasJsonValues(content, { shared: "right", fromA: true, fromB: true })
    );
    await assertResolvedHiddenContent(context.cliBinary, session.cliEnv, manualMergeJsonPath, merged);
    await stopSession(context, session);

    const parsed = JSON.parse(merged);
    assertEqual(parsed.shared, "right", "Manual JSON conflict resolution did not apply the selected merged result.");
    assertEqual(parsed.fromA, true, "Manual JSON conflict resolution lost the first-side value.");
    assertEqual(parsed.fromB, true, "Manual JSON conflict resolution lost the second-side value.");
    console.log(`Hidden JSON conflict modal applied the selected merged result. Screenshot: ${screenshotPath}`);
}

async function runJsonManualConflictReplacement(context: RunnerContext, vault: TemporaryVault): Promise<void> {
    const base = JSON.stringify({ shared: "base" }, null, 4) + "\n";
    const left = JSON.stringify({ shared: "left", fromA: true }, null, 4) + "\n";
    const right = JSON.stringify({ shared: "right", fromB: true }, null, 4) + "\n";
    const latestMarker = `hidden-json-replacement-${context.dbName}`;
    const latest = JSON.stringify({ shared: "latest", fromA: true, fromB: true, latestMarker }, null, 4) + "\n";
    const session = await startConfiguredSession(context, vault);

    await createHiddenJsonConflict(context, session, vault, replacementMergeJsonPath, base, left, right);
    await installHiddenJsonComparisonObserver(context.cliBinary, session.cliEnv);

    await startHiddenConflictResolution(context.cliBinary, session.cliEnv);
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const firstOption = page.locator('label:has(input[name="disp"][value="AB"])').last();
        await firstOption.waitFor({ state: "visible", timeout: 10000 });
        await firstOption.evaluate((element, key) => {
            const firstModal = element.closest(".modal-container");
            if (!(firstModal instanceof HTMLElement))
                throw new Error("The first JSON conflict dialogue has no modal container");
            (globalThis as unknown as Record<string, { firstModal: HTMLElement }>)[key] = { firstModal };
        }, hiddenConflictModalStateKey);
    });

    const firstDialogueState = await readHiddenJsonComparisonObservation(context.cliBinary, session.cliEnv);
    assertEqual(
        firstDialogueState.pipelineDone,
        false,
        "The hidden conflict pipeline completed before replacing its first dialogue."
    );
    assertEqual(firstDialogueState.calls.length, 1, "The first hidden JSON comparison was not observed exactly once.");
    assertEqual(
        firstDialogueState.calls[0].done,
        false,
        "The first hidden JSON comparison completed before the replacement request."
    );

    await writeVaultFile(vault.path, replacementMergeJsonPath, latest);
    const updatedWinner = await evalObsidianJson<{ rev: string }>(
        context.cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(replacementMergeJsonPath)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "const db=core.localDatabase;",
            "const entry=await db.getDBEntry(`i:${path}`);",
            "if(!entry)throw new Error(`Hidden conflict winner is missing: ${path}`);",
            "const current=await db.getRaw(entry._id,{conflicts:true});",
            "const conflictRevs=current._conflicts||[];",
            "if(conflictRevs.length!==1)throw new Error(`Expected one competing hidden leaf before replacement: ${path}`);",
            "const conflicts=await Promise.all(conflictRevs.map(rev=>db.getDBEntry(`i:${path}`,{rev},false,true,true)));",
            "if(conflicts.some(doc=>!doc))throw new Error(`Could not read the competing hidden revision: ${path}`);",
            "const mtime=Math.max(Number(entry.mtime)||0,...conflicts.map(doc=>Number(doc.mtime)||0))+10;",
            "const fileInfo=await addOn.loadFileWithInfo(path);",
            "if(fileInfo.deleted)throw new Error(`Hidden replacement file was unexpectedly deleted: ${path}`);",
            "const baseData=await addOn.__loadBaseSaveData(path,true);",
            "if(baseData===false)throw new Error(`Could not load hidden replacement save data: ${path}`);",
            "const saveData={...baseData,data:fileInfo.body,mtime,ctime:fileInfo.stat.ctime,size:fileInfo.stat.size,children:[],deleted:false,type:baseData.datatype};",
            "const result=await db.putDBEntry(saveData,false,entry._rev);",
            "if(!result?.ok)throw new Error(`Could not advance the current hidden conflict winner: ${path}`);",
            "return JSON.stringify({rev:result.rev});",
            "})()",
        ].join(""),
        session.cliEnv
    );
    const beforeQueue = await readHiddenConflictLeaves(context.cliBinary, session.cliEnv, replacementMergeJsonPath);
    assertEqual(
        beforeQueue.currentRev,
        updatedWinner.rev,
        "The latest hidden conflict revision is not the current winner."
    );
    assertEqual(
        beforeQueue.conflictRevs.length,
        1,
        "Advancing the current winner changed the competing hidden leaf count."
    );
    assertEqual(
        beforeQueue.leaves.length,
        2,
        "Advancing the current winner did not retain both hidden conflict leaves."
    );
    const beforeQueueContents = beforeQueue.leaves.map(decodeHiddenConflictLeaf);
    assertEqual(
        beforeQueueContents.includes(latest),
        true,
        "The current hidden winner does not contain the latest JSON content."
    );
    assertEqual(
        beforeQueueContents.some((content) => content === left || content === right),
        true,
        "The competing hidden leaf content is not readable after advancing the current winner."
    );

    await evalObsidianJson<unknown>(
        context.cliBinary,
        [
            "(()=>{",
            `const path=${JSON.stringify(replacementMergeJsonPath)};`,
            "const addOn=app.plugins.plugins['obsidian-livesync'].core.getAddOn('HiddenFileSync');",
            "addOn.queueConflictCheck(path);",
            "return JSON.stringify({queued:true});",
            "})()",
        ].join(""),
        session.cliEnv
    );

    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        await page.waitForFunction(
            (key) => {
                const state = (globalThis as unknown as Record<string, { firstModal: HTMLElement } | undefined>)[key];
                if (!state || state.firstModal.isConnected) return false;
                const visibleLabels = Array.from(
                    document.querySelectorAll<HTMLLabelElement>('label:has(input[name="disp"])')
                ).filter(
                    (label) => label.getClientRects().length > 0 && getComputedStyle(label).visibility !== "hidden"
                );
                const roots = new Set(visibleLabels.map((label) => label.closest(".modal-container")));
                return visibleLabels.length >= 2 && roots.size === 1;
            },
            hiddenConflictModalStateKey,
            { timeout: 10000 }
        );
        const visibleDialogueCount = await page.evaluate(() => {
            const visibleLabels = Array.from(
                document.querySelectorAll<HTMLLabelElement>('label:has(input[name="disp"])')
            ).filter((label) => label.getClientRects().length > 0 && getComputedStyle(label).visibility !== "hidden");
            return new Set(visibleLabels.map((label) => label.closest(".modal-container"))).size;
        });
        assertEqual(
            visibleDialogueCount,
            1,
            "Replacing a hidden comparison left more than one JSON conflict dialogue visible."
        );
    });

    const replacementDialogueState = await readHiddenJsonComparisonObservation(context.cliBinary, session.cliEnv);
    assertEqual(
        replacementDialogueState.pipelineDone,
        false,
        "The hidden conflict pipeline completed before the replacement dialogue was applied."
    );
    assertEqual(
        replacementDialogueState.calls.length,
        2,
        "The latest hidden conflict request did not open a second comparison."
    );
    assertEqual(
        replacementDialogueState.calls[0].done,
        true,
        "The first hidden JSON comparison did not complete when replaced."
    );
    assertEqual(replacementDialogueState.calls[0].result, false, "The first hidden JSON comparison was not cancelled.");
    assertEqual(
        [replacementDialogueState.calls[1].leftRev, replacementDialogueState.calls[1].rightRev].includes(
            updatedWinner.rev
        ),
        true,
        "The replacement JSON comparison did not include the latest current revision."
    );
    assertEqual(
        replacementDialogueState.calls[1].done,
        false,
        "The replacement JSON comparison completed before the user selected it."
    );

    const afterCancellation = await readHiddenConflictLeaves(
        context.cliBinary,
        session.cliEnv,
        replacementMergeJsonPath
    );
    assertEqual(
        afterCancellation.currentRev,
        updatedWinner.rev,
        "Cancelling the first dialogue changed the latest current revision."
    );
    assertEqual(
        afterCancellation.conflictRevs.length,
        1,
        "Cancelling the first dialogue removed the competing hidden leaf."
    );
    assertEqual(
        afterCancellation.leaves.length,
        2,
        "Cancelling the first dialogue did not preserve both hidden conflict leaves."
    );
    const afterCancellationContents = afterCancellation.leaves.map(decodeHiddenConflictLeaf);
    assertEqual(
        afterCancellationContents.includes(latest),
        true,
        "The latest hidden content became unreadable after cancelling the first dialogue."
    );
    assertEqual(
        afterCancellationContents.some((content) => content === left || content === right),
        true,
        "The competing hidden content became unreadable after cancelling the first dialogue."
    );

    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const optionAB = page.locator('label:has(input[name="disp"][value="AB"])').last();
        await optionAB.waitFor({ state: "visible", timeout: 10000 });
        await optionAB.click();
        const selected = await page.locator('input[name="disp"][value="AB"]').last().isChecked();
        assertEqual(selected, true, "The replacement JSON dialogue did not select AB.");
        await page.waitForFunction(
            (marker) => {
                const options = Array.from(
                    document.querySelectorAll<HTMLInputElement>('input[name="disp"][value="AB"]')
                );
                const option = options
                    .reverse()
                    .find((candidate) => (candidate.closest("label")?.getClientRects().length ?? 0) > 0);
                const modal = option?.closest(".modal-container");
                if (!(modal instanceof HTMLElement)) return false;
                const values = Array.from(
                    modal.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")
                ).map((element) => element.value);
                return `${modal.innerText}\n${values.join("\n")}`.includes(marker);
            },
            latestMarker,
            { timeout: 10000 }
        );
        await page.getByRole("button", { name: "Apply" }).last().click();
    });
    await waitForHiddenConflictResolution(context.cliBinary, session.cliEnv);

    const resolved = await waitForPathContent(vault.path, replacementMergeJsonPath, (content) =>
        hasJsonValues(content, { shared: "latest", fromA: true, fromB: true, latestMarker })
    );
    await assertResolvedHiddenContent(context.cliBinary, session.cliEnv, replacementMergeJsonPath, resolved);
    const parsed = JSON.parse(resolved) as Record<string, unknown>;
    assertEqual(parsed.latestMarker, latestMarker, "The applied JSON result lost the latest replacement marker.");

    const finalDialogueState = await readHiddenJsonComparisonObservation(context.cliBinary, session.cliEnv);
    assertEqual(finalDialogueState.pipelineDone, true, "The replacement hidden conflict pipeline did not finish.");
    assertEqual(
        finalDialogueState.calls[0].result,
        false,
        "The replaced hidden JSON comparison did not remain cancelled."
    );
    assertEqual(finalDialogueState.calls[1].done, true, "The replacement hidden JSON comparison did not complete.");
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const finalState = await page.evaluate((key) => {
            const state = (globalThis as unknown as Record<string, { firstModal: HTMLElement } | undefined>)[key];
            const visibleLabels = Array.from(
                document.querySelectorAll<HTMLLabelElement>('label:has(input[name="disp"])')
            ).filter((label) => label.getClientRects().length > 0 && getComputedStyle(label).visibility !== "hidden");
            return {
                firstConnected: state?.firstModal.isConnected ?? false,
                visibleDialogueCount: new Set(visibleLabels.map((label) => label.closest(".modal-container"))).size,
            };
        }, hiddenConflictModalStateKey);
        assertEqual(
            finalState.firstConnected,
            false,
            "The replaced JSON conflict dialogue remained connected after resolution."
        );
        assertEqual(
            finalState.visibleDialogueCount,
            0,
            "A stale JSON conflict dialogue remained open after resolution."
        );
    });

    await stopSession(context, session);
    console.log(
        "Hidden JSON conflict replacement cancelled the stale dialogue and applied the latest revision and contents."
    );
}

async function runJsonManualExternalResolution(context: RunnerContext, vault: TemporaryVault): Promise<void> {
    const base = JSON.stringify({ shared: "base" }, null, 4) + "\n";
    const left = JSON.stringify({ shared: "left", fromA: true }, null, 4) + "\n";
    const right = JSON.stringify({ shared: "right", fromB: true }, null, 4) + "\n";
    const unrelatedContent = JSON.stringify({ externalResolution: "unrelated" }, null, 4) + "\n";
    const session = await startConfiguredSession(context, vault);

    await writeVaultFile(vault.path, externalResolutionUnrelatedPath, unrelatedContent);
    await scanHiddenStorage(context.cliBinary, session.cliEnv);
    const unrelatedEntry = await waitForLocalDatabaseEntry(
        context.cliBinary,
        session.cliEnv,
        externalResolutionUnrelatedPath,
        {
            hidden: true,
        }
    );
    await createHiddenJsonConflict(context, session, vault, externalResolutionTargetPath, base, left, right);
    const initialLeaves = await readHiddenConflictLeaves(
        context.cliBinary,
        session.cliEnv,
        externalResolutionTargetPath
    );
    assertEqual(
        initialLeaves.conflictRevs.length,
        1,
        "The external-resolution target did not have one competing leaf."
    );
    assertEqual(initialLeaves.leaves.length, 2, "The external-resolution target did not retain two live leaves.");
    const winnerContent = decodeHiddenConflictLeaf(
        initialLeaves.leaves.find((leaf) => leaf.rev === initialLeaves.currentRev) ?? initialLeaves.leaves[0]
    );
    assertEqual(
        [left, right].includes(winnerContent),
        true,
        "The initial hidden conflict winner content is not readable."
    );
    await writeVaultFile(vault.path, externalResolutionTargetPath, winnerContent);

    await installHiddenJsonComparisonObserver(context.cliBinary, session.cliEnv);
    await startHiddenConflictResolution(context.cliBinary, session.cliEnv);
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const firstOption = page.locator('label:has(input[name="disp"][value="AB"])').last();
        await firstOption.waitFor({ state: "visible", timeout: 10000 });
        await firstOption.evaluate((element, key) => {
            const firstModal = element.closest(".modal-container");
            if (!(firstModal instanceof HTMLElement))
                throw new Error("The external-resolution JSON dialogue has no modal container");
            (globalThis as unknown as Record<string, { firstModal: HTMLElement }>)[key] = { firstModal };
        }, hiddenConflictModalStateKey);
    });

    const initialObservation = await readHiddenJsonComparisonObservation(context.cliBinary, session.cliEnv);
    assertEqual(
        initialObservation.pipelineDone,
        false,
        "The external-resolution conflict pipeline completed before a result arrived."
    );
    assertEqual(
        initialObservation.calls.length,
        1,
        "The external-resolution target did not open exactly one comparison."
    );
    assertEqual(
        initialObservation.calls[0].done,
        false,
        "The external-resolution dialogue completed before a result arrived."
    );

    const unrelatedResolution = await evalObsidianJson<{ rev: string }>(
        context.cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(externalResolutionUnrelatedPath)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const meta=await core.localDatabase.getDBEntryMeta(`i:${path}`,{conflicts:true},true);",
            "if(!meta)throw new Error(`Unrelated hidden metadata is missing: ${path}`);",
            "if((meta._conflicts||[]).length!==0)throw new Error(`Unrelated hidden metadata unexpectedly has conflicts: ${path}`);",
            "await core.services.replication.processOptionalSynchroniseResult(meta);",
            "return JSON.stringify({rev:meta._rev});",
            "})()",
        ].join(""),
        session.cliEnv,
        hiddenFileCliTimeoutMs
    );
    assertEqual(
        unrelatedResolution.rev,
        unrelatedEntry.rev,
        "The unrelated hidden fixture did not have the expected single revision."
    );
    const afterUnrelatedResult = await readHiddenJsonComparisonObservation(context.cliBinary, session.cliEnv);
    assertEqual(
        afterUnrelatedResult.pipelineDone,
        false,
        "A result for another hidden path completed the target conflict pipeline."
    );
    assertEqual(afterUnrelatedResult.calls.length, 1, "A result for another path opened another target comparison.");
    assertEqual(
        afterUnrelatedResult.calls[0].done,
        false,
        "A result for another path closed the target JSON comparison."
    );
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modalState = await page.evaluate((key) => {
            const state = (globalThis as unknown as Record<string, { firstModal: HTMLElement } | undefined>)[key];
            const visibleLabels = Array.from(
                document.querySelectorAll<HTMLLabelElement>('label:has(input[name="disp"])')
            ).filter((label) => label.getClientRects().length > 0 && getComputedStyle(label).visibility !== "hidden");
            return {
                firstConnected: state?.firstModal.isConnected ?? false,
                visibleDialogueCount: new Set(visibleLabels.map((label) => label.closest(".modal-container"))).size,
            };
        }, hiddenConflictModalStateKey);
        assertEqual(modalState.firstConnected, true, "An unrelated hidden result detached the target JSON dialogue.");
        assertEqual(
            modalState.visibleDialogueCount,
            1,
            "An unrelated hidden result changed the visible target dialogue count."
        );
    });

    const targetResolution = await evalObsidianJson<{ winnerRev: string; removedRev: string }>(
        context.cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(externalResolutionTargetPath)};`,
            "const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase;",
            "const entry=await db.getDBEntry(`i:${path}`);",
            "if(!entry)throw new Error(`Hidden conflict entry is missing: ${path}`);",
            "const current=await db.getRaw(entry._id,{conflicts:true});",
            "const conflictRevs=current._conflicts||[];",
            "if(conflictRevs.length!==1)throw new Error(`Expected one hidden conflict leaf before external resolution: ${path}`);",
            "const removedRev=conflictRevs[0];",
            "await db.removeRevision(entry._id,removedRev);",
            "const meta=await db.getDBEntryMeta(`i:${path}`,{conflicts:true},true);",
            "if(!meta)throw new Error(`Resolved hidden metadata is missing: ${path}`);",
            "if((meta._conflicts||[]).length!==0)throw new Error(`External hidden resolution still has conflicts: ${path}`);",
            "await app.plugins.plugins['obsidian-livesync'].core.services.replication.processOptionalSynchroniseResult(meta);",
            "return JSON.stringify({winnerRev:meta._rev,removedRev});",
            "})()",
        ].join(""),
        session.cliEnv,
        hiddenFileCliTimeoutMs
    );
    await waitForHiddenConflictResolution(context.cliBinary, session.cliEnv);

    const resolvedLeaves = await readHiddenConflictLeaves(
        context.cliBinary,
        session.cliEnv,
        externalResolutionTargetPath
    );
    assertEqual(
        resolvedLeaves.currentRev,
        targetResolution.winnerRev,
        "External hidden resolution changed the selected winner revision."
    );
    assertEqual(
        resolvedLeaves.currentRev,
        initialLeaves.currentRev,
        "External hidden resolution changed the current winner revision."
    );
    assertEqual(
        targetResolution.removedRev,
        initialLeaves.conflictRevs[0],
        "External hidden resolution removed a different leaf than the competing revision."
    );
    assertEqual(
        resolvedLeaves.conflictRevs.length,
        0,
        "The externally resolved hidden conflict remains in the database."
    );
    assertEqual(
        resolvedLeaves.leaves.length,
        1,
        "External hidden resolution did not leave exactly one readable revision."
    );
    assertEqual(
        decodeHiddenConflictLeaf(resolvedLeaves.leaves[0]),
        winnerContent,
        "External hidden resolution changed the current winner bytes."
    );
    const vaultWinner = await waitForPathContent(
        vault.path,
        externalResolutionTargetPath,
        (content) => content === winnerContent
    );
    await assertResolvedHiddenContent(context.cliBinary, session.cliEnv, externalResolutionTargetPath, vaultWinner);

    const finalObservation = await readHiddenJsonComparisonObservation(context.cliBinary, session.cliEnv);
    assertEqual(finalObservation.pipelineDone, true, "The externally resolved hidden conflict pipeline did not drain.");
    assertEqual(finalObservation.calls.length, 1, "External resolution opened a second JSON comparison.");
    assertEqual(finalObservation.calls[0].done, true, "The external-resolution JSON comparison did not complete.");
    assertEqual(finalObservation.calls[0].result, false, "The external-resolution JSON dialogue was not cancelled.");
    await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
        const modalState = await page.evaluate((key) => {
            const state = (globalThis as unknown as Record<string, { firstModal: HTMLElement } | undefined>)[key];
            const visibleLabels = Array.from(
                document.querySelectorAll<HTMLLabelElement>('label:has(input[name="disp"])')
            ).filter((label) => label.getClientRects().length > 0 && getComputedStyle(label).visibility !== "hidden");
            return {
                firstConnected: state?.firstModal.isConnected ?? false,
                visibleDialogueCount: new Set(visibleLabels.map((label) => label.closest(".modal-container"))).size,
            };
        }, hiddenConflictModalStateKey);
        assertEqual(modalState.firstConnected, false, "The externally resolved JSON dialogue remained connected.");
        assertEqual(
            modalState.visibleDialogueCount,
            0,
            "The old hidden conflict dialogue reopened after external resolution."
        );
    });

    await stopSession(context, session);
    console.log(
        "Hidden JSON conflict dialogue closed for an external same-path resolution and preserved the selected bytes."
    );
}

async function runTargetMismatch(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const selectors = { syncOnlyRegEx: String.raw`\.(md|pdf)$` };
    const targetContent = JSON.stringify({ onlyA: true, targetMismatch: true }, null, 4) + "\n";
    await writeVaultFile(vaultA.path, targetPath, targetContent);

    let session = await startConfiguredSession(context, vaultA, selectors);
    try {
        await uploadHiddenFile(context, session, targetPath);
    } finally {
        await stopSession(context, session);
    }

    session = await startConfiguredSession(context, vaultB, {
        ...selectors,
        syncInternalFilesTargetPatterns: "snippets",
    });
    try {
        await pullAndApplyHiddenFiles(context, session, { resolveConflicts: false });
        assertEqual(
            await pathExists(vaultB.path, targetPath),
            false,
            "Hidden file was applied on a device where it was not a target file."
        );
    } finally {
        await stopSession(context, session);
    }

    session = await startConfiguredSession(context, vaultB, {
        ...selectors,
        syncInternalFilesTargetPatterns: "",
    });
    let received = "";
    try {
        await pullAndApplyHiddenFiles(context, session, { resolveConflicts: false });
        received = await waitForPathContent(vaultB.path, targetPath, (content) => content === targetContent);
    } finally {
        await stopSession(context, session);
    }

    assertEqual(
        received,
        targetContent,
        "The normal file allow-list blocked a selected hidden file from the other device."
    );
    console.log(
        "A normal Markdown/PDF allow-list preserved hidden target exclusion and exact remote restoration after enabling the target."
    );
}

async function setHiddenFileNoticeFixtures(port: number, itemIds: string[], includeRestart: boolean): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(
            ({ nextItemIds, nextIncludeRestart }) => {
                const obsidianApp = (globalThis as typeof globalThis & { app: any }).app;
                const plugin = obsidianApp.plugins.plugins["obsidian-livesync"];
                const core = plugin.core;
                const addOn = core.getAddOn("HiddenFileSync");
                for (const id of ["alpha", "beta", "gamma"]) {
                    const pluginId = `livesync-e2e-${id}`;
                    obsidianApp.plugins.manifests[pluginId] = {
                        id: pluginId,
                        name: `E2E ${id[0]?.toUpperCase()}${id.slice(1)}`,
                        version: "1.0.0",
                        minAppVersion: "1.0.0",
                        description: "E2E fixture",
                        author: "Self-hosted LiveSync",
                        isDesktopOnly: false,
                        dir: `.obsidian/plugins/${pluginId}`,
                    };
                    obsidianApp.plugins.enabledPlugins.add(pluginId);
                }
                addOn.queuedNotificationFiles.clear();
                for (const id of nextItemIds) {
                    addOn.queuedNotificationFiles.add(`.obsidian/plugins/livesync-e2e-${id}`);
                }
                if (nextIncludeRestart) {
                    addOn.queuedNotificationFiles.add(core.services.API.getSystemConfigDir());
                }
                addOn.notifyConfigChange();
            },
            { nextItemIds: itemIds, nextIncludeRestart: includeRestart }
        );
    });
}

async function clearHiddenFileNoticeFixtures(port: number): Promise<void> {
    await withObsidianPage(port, async (page) => {
        await page.evaluate(() => {
            const obsidianApp = (globalThis as typeof globalThis & { app: any }).app;
            const plugin = obsidianApp.plugins.plugins["obsidian-livesync"];
            plugin.core.services.context.noticeGroups.hide("hidden-file-changes");
            for (const id of ["alpha", "beta", "gamma"]) {
                const pluginId = `livesync-e2e-${id}`;
                obsidianApp.plugins.enabledPlugins.delete(pluginId);
                delete obsidianApp.plugins.manifests[pluginId];
            }
        });
    });
}

async function runInitialisationNoticeGrouping(context: RunnerContext, vault: TemporaryVault): Promise<void> {
    const session = await startConfiguredSession(context, vault, {
        syncInternalFiles: false,
        syncInternalFilesBeforeReplication: false,
    });
    const port = session.remoteDebuggingPort;
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_HIDDEN_FILE_NOTICE_TIMEOUT_MS ?? 10_000);
    try {
        await withObsidianPage(port, async (page) => {
            const deadline = Date.now() + timeoutMs;
            while ((await page.locator(".notice:visible").count()) > 0 && Date.now() < deadline) {
                await page
                    .locator(".notice:visible")
                    .first()
                    .click({
                        force: true,
                        position: { x: 2, y: 2 },
                        timeout: timeoutMs,
                    });
            }
            assertEqual(
                await page.locator(".notice:visible").count(),
                0,
                "Transient start-up Notices remained before the Hidden File Sync initialisation check."
            );
        });
        await assertDisabledInitialisationIsNoOp(context, session, vault);
        await withObsidianPage(port, async (page) => {
            await page.evaluate((stateKey) => {
                const obsidianApp = (globalThis as typeof globalThis & { app: any }).app;
                const plugin = obsidianApp.plugins.plugins["obsidian-livesync"];
                const core = plugin.core;
                const addOn = core.getAddOn("HiddenFileSync");
                const setting = core.services.setting;
                const originalApplyPartial = setting.applyPartial;
                const originalRebuildMerging = addOn.rebuildMerging;
                const state = {
                    done: false,
                    reachedPreparation: false,
                    reachedInitialisation: false,
                    maxVisibleProgressNotices: 0,
                    visibleProgressNoticeTexts: [] as string[],
                    sawStandaloneGatheringNotice: false,
                    sawStandaloneRestartNotice: false,
                    releasePreparation: undefined as (() => void) | undefined,
                    releaseInitialisation: undefined as (() => void) | undefined,
                    error: undefined as string | undefined,
                };
                (globalThis as unknown as Record<string, typeof state>)[stateKey] = state;

                const observer = new MutationObserver(() => {
                    const notices = Array.from(document.querySelectorAll<HTMLElement>(".notice"));
                    const progressNotices = notices.filter((notice) => notice.textContent?.includes("[⚙"));
                    state.sawStandaloneGatheringNotice ||= notices.some((notice) =>
                        notice.textContent?.includes("Gathering files for enabling Hidden File Sync")
                    );
                    state.sawStandaloneRestartNotice ||= notices.some((notice) =>
                        notice.textContent?.includes("Done! Restarting the app is strongly recommended!")
                    );
                    if (progressNotices.length > state.maxVisibleProgressNotices) {
                        state.maxVisibleProgressNotices = progressNotices.length;
                        state.visibleProgressNoticeTexts = progressNotices.map(
                            (notice) => notice.textContent?.trim() ?? ""
                        );
                    }
                });
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                });

                setting.applyPartial = async (...args: unknown[]) => {
                    const update = args[0] as { syncInternalFiles?: unknown } | undefined;
                    if (update?.syncInternalFiles === true && !state.reachedPreparation) {
                        state.reachedPreparation = true;
                        await new Promise<void>((resolve) => {
                            state.releasePreparation = resolve;
                        });
                    }
                    return await originalApplyPartial.apply(setting, args);
                };

                addOn.rebuildMerging = async (...args: unknown[]) => {
                    state.reachedInitialisation = true;
                    await new Promise<void>((resolve) => {
                        state.releaseInitialisation = resolve;
                    });
                    return await originalRebuildMerging.apply(addOn, args);
                };

                void core.services.setting
                    .enableOptionalFeature("MERGE")
                    .then(
                        () => {
                            state.done = true;
                        },
                        (error: unknown) => {
                            state.error = error instanceof Error ? error.message : String(error);
                            state.done = true;
                        }
                    )
                    .finally(() => {
                        setting.applyPartial = originalApplyPartial;
                        addOn.rebuildMerging = originalRebuildMerging;
                        const notices = Array.from(document.querySelectorAll<HTMLElement>(".notice"));
                        const progressNotices = notices.filter((notice) => notice.textContent?.includes("[⚙"));
                        state.sawStandaloneGatheringNotice ||= notices.some((notice) =>
                            notice.textContent?.includes("Gathering files for enabling Hidden File Sync")
                        );
                        state.sawStandaloneRestartNotice ||= notices.some((notice) =>
                            notice.textContent?.includes("Done! Restarting the app is strongly recommended!")
                        );
                        if (progressNotices.length > state.maxVisibleProgressNotices) {
                            state.maxVisibleProgressNotices = progressNotices.length;
                            state.visibleProgressNoticeTexts = progressNotices.map(
                                (notice) => notice.textContent?.trim() ?? ""
                            );
                        }
                        observer.disconnect();
                    });
            }, hiddenFileInitialisationStateKey);
        });

        const screenshotPath = await captureObsidianPage(
            port,
            "hidden-file-initial-scan-progress.png",
            async (page) => {
                await page.waitForFunction(
                    (stateKey) =>
                        (globalThis as unknown as Record<string, { reachedPreparation?: boolean } | undefined>)[
                            stateKey
                        ]?.reachedPreparation === true,
                    hiddenFileInitialisationStateKey,
                    { timeout: timeoutMs }
                );
                const progressNotices = page.locator(".notice").filter({ hasText: "[⚙" });
                await progressNotices.first().waitFor({ state: "visible", timeout: timeoutMs });
                assertEqual(
                    await progressNotices.count(),
                    1,
                    "Hidden File Sync showed more than one progress Notice before saving its enabled setting."
                );
                await progressNotices
                    .filter({ hasText: "Preparing Hidden File Sync..." })
                    .waitFor({ state: "visible", timeout: timeoutMs });
            }
        );

        const result = await withObsidianPage(port, async (page) => {
            await page.evaluate((stateKey) => {
                const state = (
                    globalThis as unknown as Record<string, { releasePreparation?: () => void } | undefined>
                )[stateKey];
                state?.releasePreparation?.();
            }, hiddenFileInitialisationStateKey);
            await page.waitForFunction(
                (stateKey) =>
                    (globalThis as unknown as Record<string, { reachedInitialisation?: boolean } | undefined>)[stateKey]
                        ?.reachedInitialisation === true,
                hiddenFileInitialisationStateKey,
                { timeout: timeoutMs }
            );
            const progressNotices = page.locator(".notice").filter({ hasText: "[⚙" });
            assertEqual(
                await progressNotices.count(),
                1,
                "Hidden File Sync replaced its parent progress Notice when the first child phase started."
            );
            await page.evaluate((stateKey) => {
                const state = (
                    globalThis as unknown as Record<string, { releaseInitialisation?: () => void } | undefined>
                )[stateKey];
                state?.releaseInitialisation?.();
            }, hiddenFileInitialisationStateKey);
            await page.waitForFunction(
                (stateKey) =>
                    (globalThis as unknown as Record<string, { done?: boolean } | undefined>)[stateKey]?.done === true,
                hiddenFileInitialisationStateKey,
                { timeout: hiddenFileCliTimeoutMs }
            );
            return await page.evaluate(
                (stateKey) =>
                    (
                        globalThis as unknown as Record<
                            string,
                            {
                                error?: string;
                                maxVisibleProgressNotices: number;
                                visibleProgressNoticeTexts: string[];
                                sawStandaloneGatheringNotice: boolean;
                                sawStandaloneRestartNotice: boolean;
                            }
                        >
                    )[stateKey],
                hiddenFileInitialisationStateKey
            );
        });
        if (result.error) {
            throw new Error(`Hidden File Sync initialisation failed: ${result.error}`);
        }
        assertEqual(
            result.maxVisibleProgressNotices,
            1,
            `Hidden File Sync split initialisation across multiple progress Notices: ${JSON.stringify(
                result.visibleProgressNoticeTexts
            )}`
        );
        assertEqual(
            result.sawStandaloneGatheringNotice,
            false,
            "Hidden File Sync showed the old standalone gathering Notice."
        );
        assertEqual(
            result.sawStandaloneRestartNotice,
            false,
            "Hidden File Sync showed the old standalone restart recommendation."
        );
        console.log(
            `Hidden File Sync showed one progress Notice before settings were saved and retained it throughout initialisation. Screenshot: ${screenshotPath}`
        );
    } finally {
        await stopSession(context, session);
    }
}

async function runConfigurationNoticeGrouping(context: RunnerContext, vault: TemporaryVault): Promise<void> {
    const session = await startConfiguredSession(context, vault);
    const port = session.remoteDebuggingPort;
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_HIDDEN_FILE_NOTICE_TIMEOUT_MS ?? 10_000);
    try {
        await setObsidianMobileTestMode(port, true, timeoutMs);
        await setHiddenFileNoticeFixtures(port, ["alpha", "beta"], true);

        await withObsidianPage(port, async (page) => {
            const visibleGroups = page.locator(".notice:has(.vpk-keyed-notice-group):visible");
            await visibleGroups.first().waitFor({ state: "visible", timeout: timeoutMs });
            assertEqual(await visibleGroups.count(), 1, "Hidden File Sync created more than one visible Notice group.");

            const notice = visibleGroups.first();
            const rows = notice.locator(".vpk-keyed-notice-group__item");
            assertEqual(await rows.count(), 3, "Hidden File Sync did not group every configuration-change action.");
            await notice.getByText("Files in E2E Alpha were updated.", { exact: true }).waitFor();
            await notice.getByText("Files in E2E Beta were updated.", { exact: true }).waitFor();
            await notice.getByText("Other Obsidian settings files were updated.", { exact: true }).waitFor();

            await assertLocatorWithinViewport(page, notice, { label: "Hidden File Sync notification group" });
            await assertNoHorizontalOverflow(page, notice, { label: "Hidden File Sync notification group" });
            await assertLocatorWithinSafeArea(page, notice, {
                label: "Hidden File Sync notification group",
                safeAreaInsets: iPhoneSafeArea,
            });
            const buttons = notice.getByRole("button");
            for (let index = 0; index < (await buttons.count()); index += 1) {
                await assertLocatorHasMinimumTouchTarget(page, buttons.nth(index), {
                    label: `Hidden File Sync notification action ${index + 1}`,
                });
            }

            const outputDirectory = process.env.E2E_OBSIDIAN_DIAGNOSTICS_DIR ?? "/tmp/obsidian-livesync-e2e";
            const screenshotPath = join(outputDirectory, "hidden-file-notice-group-mobile.png");
            await mkdir(dirname(screenshotPath), { recursive: true });
            await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });

            await rows.first().getByText("Files in E2E Alpha were updated.", { exact: true }).click();
            await notice.waitFor({ state: "hidden", timeout: timeoutMs });
        });

        await setHiddenFileNoticeFixtures(port, ["gamma"], false);
        await withObsidianPage(port, async (page) => {
            const notice = page.locator(".notice:has(.vpk-keyed-notice-group):visible").first();
            await notice.waitFor({ state: "visible", timeout: timeoutMs });
            const rows = notice.locator(".vpk-keyed-notice-group__item");
            assertEqual(await rows.count(), 1, "A dismissed Hidden File Sync Notice repeated acknowledged rows.");
            await rows.getByText("Files in E2E Gamma were updated.", { exact: true }).waitFor();
        });

        console.log(
            "Hidden File Sync grouped configuration notifications passed the mobile regression for issue #555."
        );
    } finally {
        await clearHiddenFileNoticeFixtures(port).catch(() => undefined);
        await setObsidianMobileTestMode(port, false, timeoutMs).catch(() => undefined);
        await stopSession(context, session);
    }
}

type HiddenEnablementMode = "Merge" | "Fetch" | "Overwrite";

async function enableHiddenSyncThroughSettings(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    vault: TemporaryVault,
    mode: HiddenEnablementMode
): Promise<void> {
    const stateKey = "__livesyncE2EHiddenEnablement";
    await evalObsidianJson(
        context.cliBinary,
        `(()=>{
        const core=app.plugins.plugins['obsidian-livesync'].core;
        if(core.settings.syncInternalFiles)throw new Error('Hidden File Sync must start disabled');
        const setting=core.services.setting;
        const original=setting.enableOptionalFeature;
        const state={done:false,error:null,mode:null,restore:()=>{setting.enableOptionalFeature=original;}};
        globalThis[${JSON.stringify(stateKey)}]=state;
        setting.enableOptionalFeature=async function(mode){
            state.mode=mode;
            try{return await original.call(this,mode);}
            catch(error){state.error=String(error);throw error;}
            finally{state.done=true;state.restore();}
        };
        return JSON.stringify(true);
    })()`,
        session.cliEnv
    );
    try {
        await withObsidianPage(session.remoteDebuggingPort, async (page) => {
            const navigator = await openLiveSyncSettings(page);
            const settingsPage = await navigator.openPage("Sync Settings");
            const row = settingsPage.locator(".setting-item").filter({
                has: navigator.page.getByRole("button", { name: "Merge", exact: true }),
            });
            await row.getByRole("button", { name: mode, exact: true }).click();
        });
        const result = await evalObsidianJson<{ mode: string; enabled: boolean }>(
            context.cliBinary,
            `
            (async()=>{
                const state=globalThis[${JSON.stringify(stateKey)}];
                const deadline=Date.now()+60000;
                while(!state.done&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
                if(!state.done)throw new Error('Hidden File Sync enablement did not complete');
                if(state.error)throw new Error(state.error);
                const core=app.plugins.plugins['obsidian-livesync'].core;
                return JSON.stringify({mode:state.mode,enabled:core.settings.syncInternalFiles});
            })()
        `,
            session.cliEnv,
            hiddenFileCliTimeoutMs
        );
        assertEqual(result.mode, mode.toUpperCase(), "The settings action invoked a different enablement mode.");
        assertEqual(result.enabled, true, "Hidden File Sync was not enabled by its settings action.");
        const saved = JSON.parse(await readVaultFile(vault.path, ".obsidian/plugins/obsidian-livesync/data.json"));
        assertEqual(saved.syncInternalFiles, true, "Hidden File Sync enablement was not persisted.");
    } finally {
        await evalObsidianJson(
            context.cliBinary,
            `(()=>{
            globalThis[${JSON.stringify(stateKey)}]?.restore();
            delete globalThis[${JSON.stringify(stateKey)}];
            return JSON.stringify(true);
        })()`,
            session.cliEnv
        );
    }
}

async function startPersistedSession(context: RunnerContext, vault: TemporaryVault): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({ binary: context.binary, cliBinary: context.cliBinary, vault });
    context.activeSessions.add(session);
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    const enabled = await evalObsidianJson<boolean>(
        context.cliBinary,
        "JSON.stringify(app.plugins.plugins['obsidian-livesync'].core.settings.syncInternalFiles)",
        session.cliEnv
    );
    assertEqual(enabled, true, "Hidden File Sync enablement did not survive restart.");
    return session;
}

async function verifyHiddenFiles(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    vault: TemporaryVault,
    expected: Record<string, string>
): Promise<void> {
    for (const [path, content] of Object.entries(expected)) {
        await waitForPathContent(vault.path, path, (actual) => actual === content);
        await assertResolvedHiddenContent(context.cliBinary, session.cliEnv, path, content);
    }
}

async function runHiddenEnablement(context: RunnerContext, mode: HiddenEnablementMode): Promise<void> {
    const source = await createTemporaryVault();
    context.temporaryVaults.add(source);
    const target = await createTemporaryVault();
    context.temporaryVaults.add(target);
    const root = `.obsidian/livesync-enable-${mode.toLowerCase()}`;
    const localNewer = `${root}/local-newer.json`;
    const remoteNewer = `${root}/remote-newer.json`;
    const remoteOnly = `${root}/remote-only.json`;
    const localOnly = `${root}/local-only.json`;
    context.diagnosticPaths = [localNewer, remoteNewer, remoteOnly, localOnly];
    const remoteContent = JSON.stringify({ source: "remote", mode }) + "\n";
    const localContent = JSON.stringify({ source: "local", mode }) + "\n";
    const timestamp = Math.floor(Date.now() / 1000) - 120;
    for (const path of [localNewer, remoteNewer, remoteOnly]) {
        await writeVaultFile(source.path, path, remoteContent);
        await utimes(join(source.path, path), timestamp + 10, timestamp + 10);
    }
    const settings = {
        syncInternalFiles: false,
        useAdvancedMode: true,
        syncInternalFilesTargetPatterns: `^\\.obsidian(?:$|/livesync-enable-${mode.toLowerCase()}(?:/|$))`,
    };
    let session = await startConfiguredSession(context, source, settings);
    await enableHiddenSyncThroughSettings(context, session, source, "Overwrite");
    await verifyHiddenFiles(context, session, source, {
        [localNewer]: remoteContent,
        [remoteNewer]: remoteContent,
        [remoteOnly]: remoteContent,
    });
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    const uploaded: LocalDatabaseEntry[] = [];
    for (const path of [localNewer, remoteNewer, remoteOnly]) {
        uploaded.push(await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path, { hidden: true }));
    }
    await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) =>
        uploaded.every((entry) => docs.some((doc) => doc._id === entry.id && doc._rev === entry.rev))
    );
    await stopSession(context, session);

    for (const [path, time] of [
        [localNewer, timestamp + 30],
        [remoteNewer, timestamp],
        [localOnly, timestamp + 30],
    ] as const) {
        await writeVaultFile(target.path, path, localContent);
        await utimes(join(target.path, path), time, time);
    }
    session = await startConfiguredSession(context, target, settings);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    for (const path of [localNewer, remoteNewer]) {
        assertEqual(await readVaultFile(target.path, path), localContent, "Disabled sync replaced a local fixture.");
    }
    const receivedRevisions = await evalObsidianJson<string[]>(
        context.cliBinary,
        `(async()=>{
        const db=app.plugins.plugins['obsidian-livesync'].core.localDatabase;
        const revisions=[];
        for(const id of ${JSON.stringify(uploaded.map((entry) => entry.id))}) {
            const doc=await db.getRaw(id);
            revisions.push(doc._rev);
        }
        return JSON.stringify(revisions);
    })()`,
        session.cliEnv
    );
    assertEqual(
        JSON.stringify(receivedRevisions),
        JSON.stringify(uploaded.map((entry) => entry.rev)),
        "Disabled Hidden File Sync did not retain the uploaded revisions in its database."
    );
    assertEqual(await pathExists(target.path, remoteOnly), false, "Disabled sync reflected a remote-only file.");

    await enableHiddenSyncThroughSettings(context, session, target, mode);
    const expected = {
        [localNewer]: mode === "Fetch" ? remoteContent : localContent,
        [remoteNewer]: mode === "Overwrite" ? localContent : remoteContent,
        [remoteOnly]: remoteContent,
        [localOnly]: localContent,
    };
    await verifyHiddenFiles(context, session, target, expected);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopSession(context, session);

    session = await startPersistedSession(context, target);
    await verifyHiddenFiles(context, session, target, expected);
    await stopSession(context, session);

    session = await startPersistedSession(context, source);
    await pullAndApplyHiddenFiles(context, session);
    await verifyHiddenFiles(context, session, source, expected);
    await stopSession(context, session);
    console.log(
        `Hidden File Sync ${mode} preserved the selected contents in files and the database, after restart, and on the other device.`
    );
}

async function main(): Promise<void> {
    const selectedCase = process.argv.find((argument) => argument.startsWith("--case="))?.slice(7);
    if (
        selectedCase &&
        selectedCase !== "conflicts" &&
        selectedCase !== "replacement" &&
        selectedCase !== "external-resolution" &&
        selectedCase !== "enablement"
    ) {
        throw new Error("Use --case=conflicts, --case=replacement, --case=external-resolution, or --case=enablement.");
    }
    const conflictsOnly = selectedCase === "conflicts";
    const replacementOnly = selectedCase === "replacement";
    const externalResolutionOnly = selectedCase === "external-resolution";
    const enablementOnly = selectedCase === "enablement";
    const selectedMode = process.argv.find((argument) => argument.startsWith("--mode="))?.slice(7);
    const enablementModes = (["Merge", "Fetch", "Overwrite"] as const).filter(
        (mode) => !selectedMode || selectedMode === mode
    );
    if (selectedMode && (!enablementOnly || enablementModes.length !== 1)) {
        throw new Error("Use --case=enablement with --mode=Merge, --mode=Fetch, or --mode=Overwrite.");
    }
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "hidden-roundtrip");
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const context: RunnerContext = {
        binary,
        cliBinary: cli.binary,
        couchDb,
        dbName,
        activeSessions: new Set(),
        temporaryVaults: new Set([vaultA, vaultB]),
        diagnosticPaths: [
            mergeJsonPath,
            manualMergeJsonPath,
            replacementMergeJsonPath,
            externalResolutionTargetPath,
            externalResolutionUnrelatedPath,
            snippetPath,
        ],
    };

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault A: ${vaultA.path}`);
        console.log(`Temporary vault B: ${vaultB.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        if (!conflictsOnly && !replacementOnly && !externalResolutionOnly && !enablementOnly) {
            await runCreateRoundTrip(context, vaultA, vaultB);
            await runDeleteRoundTrip(context, vaultA, vaultB);
        }
        if (!enablementOnly && !replacementOnly && !externalResolutionOnly) {
            await runJsonConflictRoundTrip(context, vaultA, vaultB);
            await runJsonManualConflictResolution(context, vaultB);
        }
        if (!enablementOnly && !externalResolutionOnly) {
            await runJsonManualConflictReplacement(context, vaultB);
        }
        if (!enablementOnly && !replacementOnly) {
            await runJsonManualExternalResolution(context, vaultB);
        }
        if (!conflictsOnly && !replacementOnly && !externalResolutionOnly && !enablementOnly) {
            await runTargetMismatch(context, vaultA, vaultB);
            await runInitialisationNoticeGrouping(context, vaultB);
            await runConfigurationNoticeGrouping(context, vaultB);
        }
        if (!conflictsOnly && !replacementOnly && !externalResolutionOnly) {
            for (const mode of enablementModes) await runHiddenEnablement(context, mode);
        }
    } catch (error) {
        for (const session of context.activeSessions) {
            await captureObsidianPage(
                session.remoteDebuggingPort,
                "hidden-file-workflow-failure.png",
                async () => {}
            ).catch((captureError: unknown) => console.error(String(captureError)));
            await evalObsidianJson(
                cli.binary,
                [
                    "(async()=>{",
                    "const core=app.plugins.plugins['obsidian-livesync'].core;",
                    "const addOn=core.getAddOn('HiddenFileSync');",
                    `const paths=${JSON.stringify(context.diagnosticPaths)};`,
                    "const files=await addOn.scanInternalFileNames();",
                    "const observations=[];",
                    "for(const path of paths){",
                    "const stat=await core.storageAccess.statHidden(path);",
                    "const entry=await core.localDatabase.getDBEntryMeta(`i:${path}`,{conflicts:true});",
                    "observations.push({path,selected:files.includes(path),target:await addOn.isTargetFile(path),stat,processed:addOn.getLastProcessedFileKey(path),entry:entry?{rev:entry._rev,conflicts:entry._conflicts||[]}:false});",
                    "}",
                    `const operation=globalThis[${JSON.stringify(hiddenConflictStateKey)}];`,
                    "return JSON.stringify({enabled:core.settings.syncInternalFiles,ready:core.localDatabase.isReady,remaining:addOn.conflictResolutionProcessor.totalRemaining,operation,observations});",
                    "})()",
                ].join(""),
                session.cliEnv
            )
                .then((snapshot) => console.error("Hidden-file failure state:", JSON.stringify(snapshot)))
                .catch((snapshotError: unknown) => console.error(String(snapshotError)));
        }
        throw error;
    } finally {
        for (const session of context.activeSessions) await stopSession(context, session);
        for (const vault of context.temporaryVaults) await vault.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await deleteCouchDbDatabase(couchDb, dbName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
