import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
    configureCouchDb,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { clickJsonResolveOption, obsidianRemoteDebuggingPort } from "../runner/ui.ts";
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
const targetPath = ".obsidian/livesync-targeted/only-a.json";
const hiddenFileCliTimeoutMs = Number(process.env.E2E_OBSIDIAN_HIDDEN_FILE_CLI_TIMEOUT_MS ?? 90000);

type RunnerContext = {
    binary: string;
    cliBinary: string;
    couchDb: CouchDbConfig;
    dbName: string;
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

async function autoMergeHiddenJsonConflict(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const prefixedPath=`i:${path}`;",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "let doc=false;",
            "for await (const entry of core.localDatabase.findEntries('i:','i;',{conflicts:true})){",
            "  if(entry.path===prefixedPath){ doc=entry; break; }",
            "}",
            "if(!doc) throw new Error(`Could not find hidden conflict candidate: ${path}`);",
            "if(!doc._conflicts?.length) throw new Error(`Hidden file has no conflicts: ${path}`);",
            "const conflicts=doc._conflicts.sort((a,b)=>Number(a.split('-')[0])-Number(b.split('-')[0]));",
            "const conflictedRev=conflicts[0];",
            "const conflictedRevNo=Number(conflictedRev.split('-')[0]);",
            "const revFrom=await core.localDatabase.getRaw(doc._id,{revs_info:true});",
            "const commonBase=(revFrom._revs_info||[])",
            "  .filter((rev)=>rev.status==='available'&&Number(rev.rev.split('-')[0])<conflictedRevNo)",
            "  .map((rev)=>rev.rev)[0]||'';",
            "const result=await core.localDatabase.managers.conflictManager.mergeObject(",
            "  doc.path, commonBase, doc._rev, conflictedRev",
            ");",
            "if(!result){",
            "  throw new Error(`Hidden JSON conflict was not auto-mergeable: ${path}; base=${commonBase}; current=${doc._rev}; conflict=${conflictedRev}`);",
            "}",
            "await addOn.ensureDir(path);",
            "const stat=await addOn.writeFile(path,result);",
            "if(!stat) throw new Error(`Could not write merged hidden file: ${path}`);",
            "await addOn.storeInternalFileToDatabase({path,mtime:stat.mtime,ctime:stat.ctime,size:stat.size},true);",
            "await core.localDatabase.removeRevision(doc._id,conflictedRev);",
            "await addOn.extractInternalFileFromDatabase(path);",
            "await addOn.scanAllDatabaseChanges(true);",
            "return JSON.stringify({ok:true,merged:JSON.parse(result)});",
            "})()",
        ].join(""),
        env
    );
}

async function openHiddenJsonResolveModal(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const prefixedPath=`i:${path}`;",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const addOn=core.getAddOn('HiddenFileSync');",
            "let doc=false;",
            "for await (const entry of core.localDatabase.findEntries('i:','i;',{conflicts:true})){",
            "  if(entry.path===prefixedPath){ doc=entry; break; }",
            "}",
            "if(!doc?._conflicts?.length) throw new Error(`Could not find hidden JSON conflict: ${path}`);",
            "const conflicts=doc._conflicts.sort((a,b)=>Number(a.split('-')[0])-Number(b.split('-')[0]));",
            "const docA=await core.localDatabase.getDBEntry(prefixedPath,{rev:doc._rev});",
            "const docB=await core.localDatabase.getDBEntry(prefixedPath,{rev:conflicts[0]});",
            "if(docA===false||docB===false) throw new Error(`Could not load conflicted hidden JSON entries: ${path}`);",
            "void addOn.showJSONMergeDialogAndMerge(docA,docB);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
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
}

async function startConfiguredSession(
    context: RunnerContext,
    vault: TemporaryVault,
    overrides: Record<string, unknown> = {}
): Promise<ObsidianLiveSyncSession> {
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
    });
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await configureCouchDb(
        context.cliBinary,
        session.cliEnv,
        {
            uri: context.couchDb.uri,
            username: context.couchDb.username,
            password: context.couchDb.password,
            dbName: context.dbName,
        },
        {
            syncInternalFiles: true,
            syncInternalFilesBeforeReplication: true,
            watchInternalFileChanges: false,
            syncInternalFilesTargetPatterns: "",
            ...overrides,
        }
    );
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await prepareRemote(context.cliBinary, session.cliEnv);
    return session;
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
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB);
    await pullAndApplyHiddenFiles(context, session);
    const received = await waitForPathContent(vaultB.path, snippetPath, (content) => content === snippetContent);
    await session.app.stop();

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
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB);
    await pullAndApplyHiddenFiles(context, session);
    await waitForPathDeleted(vaultB.path, snippetPath);
    await session.app.stop();

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
    await autoMergeHiddenJsonConflict(context.cliBinary, session.cliEnv, mergeJsonPath);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    const mergedOnB = await waitForPathContent(vaultB.path, mergeJsonPath, (content) =>
        hasJsonValues(content, { fromA: true, fromB: true })
    );
    await session.app.stop();

    session = await startConfiguredSession(context, vaultA);
    await pullAndApplyHiddenFiles(context, session);
    const mergedOnA = await waitForPathContent(vaultA.path, mergeJsonPath, (content) =>
        hasJsonValues(content, { fromA: true, fromB: true })
    );
    await session.app.stop();

    assertEqual(mergedOnA, mergedOnB, "Merged hidden JSON content was not consistent across both vaults.");
    console.log("Hidden JSON conflict was automatically merged and round-tripped.");
}

async function runJsonManualConflictResolution(context: RunnerContext, vault: TemporaryVault): Promise<void> {
    const base = JSON.stringify({ shared: "base" }, null, 4) + "\n";
    const left = JSON.stringify({ shared: "left", fromA: true }, null, 4) + "\n";
    const right = JSON.stringify({ shared: "right", fromB: true }, null, 4) + "\n";

    const session = await startConfiguredSession(context, vault);
    await createHiddenJsonConflict(context, session, vault, manualMergeJsonPath, base, left, right);
    await openHiddenJsonResolveModal(context.cliBinary, session.cliEnv, manualMergeJsonPath);
    await clickJsonResolveOption(obsidianRemoteDebuggingPort(), "AB");

    const merged = await waitForPathContent(vault.path, manualMergeJsonPath, (content) =>
        hasJsonValues(content, { shared: "right", fromA: true, fromB: true })
    );
    await session.app.stop();

    const parsed = JSON.parse(merged);
    assertEqual(parsed.shared, "right", "Manual JSON conflict resolution did not apply the selected merged result.");
    assertEqual(parsed.fromA, true, "Manual JSON conflict resolution lost the first-side value.");
    assertEqual(parsed.fromB, true, "Manual JSON conflict resolution lost the second-side value.");
    console.log("Hidden JSON conflict modal applied the selected merged result.");
}

async function runTargetMismatch(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const targetContent = JSON.stringify({ onlyA: true, targetMismatch: true }, null, 4) + "\n";
    await writeVaultFile(vaultA.path, targetPath, targetContent);

    let session = await startConfiguredSession(context, vaultA);
    try {
        await uploadHiddenFile(context, session, targetPath);
    } finally {
        await session.app.stop();
    }

    session = await startConfiguredSession(context, vaultB, {
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
        await session.app.stop();
    }

    session = await startConfiguredSession(context, vaultB, {
        syncInternalFilesTargetPatterns: "",
    });
    let received = "";
    try {
        await pullAndApplyHiddenFiles(context, session, { resolveConflicts: false });
        received = await waitForPathContent(vaultB.path, targetPath, (content) => content === targetContent);
    } finally {
        await session.app.stop();
    }

    assertEqual(received, targetContent, "Hidden file was not applied after it became a target file.");
    console.log("Hidden target mismatch respected per-device target patterns, then applied after enabling the target.");
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "hidden-roundtrip");
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const context: RunnerContext = { binary, cliBinary: cli.binary, couchDb, dbName };

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault A: ${vaultA.path}`);
        console.log(`Temporary vault B: ${vaultB.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        await runCreateRoundTrip(context, vaultA, vaultB);
        await runDeleteRoundTrip(context, vaultA, vaultB);
        await runJsonConflictRoundTrip(context, vaultA, vaultB);
        await runJsonManualConflictResolution(context, vaultB);
        await runTargetMismatch(context, vaultA, vaultB);
    } finally {
        await vaultA.dispose();
        await vaultB.dispose();
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
