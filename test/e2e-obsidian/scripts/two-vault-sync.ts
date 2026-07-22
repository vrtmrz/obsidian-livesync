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
import { waitForExactCaseOnlyRename } from "../runner/pathAssertions.ts";
import {
    assertEqual,
    assertE2eCompatibilityMarker,
    assertE2eCompatibilityReviewPending,
    configureCouchDb,
    createE2eCouchDbPluginData,
    prepareRemote,
    pushLocalChanges,
    resumeCompatibilityReview,
    waitForLiveSyncCoreReady,
    waitForLocalDatabaseEntry,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "20000";

const createPath = "E2E/two-vault/create.md";
const updatePath = "E2E/two-vault/update.md";
const deletePath = "E2E/two-vault/delete.md";
const renameFromPath = "E2E/two-vault/rename-source.md";
const renameToPath = "E2E/two-vault/renamed/rename-target.md";
const caseRenameFromPath = "E2E/two-vault/Case-Rename.md";
const caseRenameToPath = "E2E/two-vault/case-rename.md";
const conflictPath = "E2E/two-vault/conflict.md";
const conflictEditPath = "E2E/two-vault/conflict-operations/edit.md";
const conflictDeletePath = "E2E/two-vault/conflict-operations/delete.md";
const conflictCaseFromPath = "E2E/two-vault/conflict-operations/Case-Rename.md";
const conflictCaseToPath = "E2E/two-vault/conflict-operations/case-rename.md";
const conflictRenameFromPath = "E2E/two-vault/conflict-operations/rename-source.md";
const conflictRenameToPath = "E2E/two-vault/conflict-operations/renamed/rename-target.md";
const targetMismatchPath = "E2E/two-vault/target-mismatch.md";
const encryptedPath = "E2E/two-vault/encrypted.md";

type RunnerContext = {
    binary: string;
    cliBinary: string;
    couchDb: CouchDbConfig;
    dbName: string;
    reviewedVaults: Set<string>;
    activeSessions: Set<ObsidianLiveSyncSession>;
};

type FileConflictState = {
    currentRev: string;
    branches: {
        rev: string;
        parentRev?: string;
        content: string;
        deleted: boolean;
        path: string;
    }[];
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

async function stopTrackedSession(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    if (!context.activeSessions.has(session)) return;
    await session.app.stop();
    context.activeSessions.delete(session);
}

async function stopTrackedSessions(context: RunnerContext): Promise<void> {
    for (const session of [...context.activeSessions]) {
        await stopTrackedSession(context, session);
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

async function writeNoteViaObsidian(cliBinary: string, env: NodeJS.ProcessEnv, path: string, content: string) {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            "const folder=path.split('/').slice(0,-1).join('/');",
            "if(folder&&!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.modify(existing,content);",
            "else await app.vault.create(path,content);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function deleteNoteViaObsidian(cliBinary: string, env: NodeJS.ProcessEnv, path: string) {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.delete(existing);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function renameNoteViaObsidian(cliBinary: string, env: NodeJS.ProcessEnv, fromPath: string, toPath: string) {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const fromPath=${JSON.stringify(fromPath)};`,
            `const toPath=${JSON.stringify(toPath)};`,
            "const folder=toPath.split('/').slice(0,-1).join('/');",
            "if(folder&&!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "const existing=app.vault.getAbstractFileByPath(fromPath);",
            "if(!existing) throw new Error(`Could not find note to rename: ${fromPath}`);",
            "await app.vault.rename(existing,toPath);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
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
    const reviewAlreadyCompleted = context.reviewedVaults.has(vault.path);
    const session = await startObsidianLiveSyncSession({
        binary: context.binary,
        cliBinary: context.cliBinary,
        vault,
        startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        pluginData: createE2eCouchDbPluginData(couchDbSettings, overrides),
    });
    context.activeSessions.add(session);
    try {
        await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
        if (!reviewAlreadyCompleted) {
            await assertE2eCompatibilityReviewPending(context.cliBinary, session.cliEnv);
            await resumeCompatibilityReview(session.remoteDebuggingPort);
        }
        await assertE2eCompatibilityMarker(context.cliBinary, session.cliEnv);
        if (!reviewAlreadyCompleted) context.reviewedVaults.add(vault.path);
        await configureCouchDb(context.cliBinary, session.cliEnv, couchDbSettings, overrides);
        await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
        await prepareRemote(context.cliBinary, session.cliEnv);
        return session;
    } catch (error) {
        try {
            await stopTrackedSession(context, session);
        } catch (stopError) {
            throw Object.assign(new Error("Could not stop Obsidian after session setup failed."), {
                cause: error,
                stopError,
            });
        }
        throw error;
    }
}

async function uploadNote(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    path: string
): Promise<LocalDatabaseEntry> {
    const entry = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await waitForCouchDbDocs(context.couchDb, context.dbName, (docs) => {
        const ids = new Set(docs.map((doc) => doc._id));
        return ids.has(entry.id) && entry.children.every((childId) => ids.has(childId));
    });
    return entry;
}

async function syncAndApply(context: RunnerContext, session: ObsidianLiveSyncSession): Promise<void> {
    await pushLocalChanges(context.cliBinary, session.cliEnv);
}

async function storeFileRevision(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    content: string,
    baseRev?: string
): Promise<string> {
    const result = await evalObsidianJson<{ rev: string }>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            `const baseRev=${JSON.stringify(baseRev ?? "")};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const blob=new Blob([content],{type:'text/plain'});",
            "const id=await core.services.path.path2id(path);",
            "const now=Date.now();",
            "const result=await core.localDatabase.putDBEntry({",
            "  _id:id,",
            "  path,",
            "  data:blob,",
            "  ctime:now,",
            "  mtime:now,",
            "  size:(await blob.arrayBuffer()).byteLength,",
            "  children:[],",
            "  datatype:'plain',",
            "  type:'plain',",
            "  eden:{},",
            "},false,baseRev||undefined);",
            "if(!result?.ok) throw new Error(`Could not store file revision: ${path}`);",
            "return JSON.stringify({ok:true,rev:result.rev});",
            "})()",
        ].join(""),
        env
    );
    return result.rev;
}

async function readFileConflictState(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string
): Promise<FileConflictState> {
    return await evalObsidianJson<FileConflictState>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const meta=await core.localDatabase.getDBEntryMeta(path,{conflicts:true},true);",
            "if(!meta) throw new Error(`Could not find conflict metadata: ${path}`);",
            "const revisions=[meta._rev,...(meta._conflicts??[])];",
            "const branches=[];",
            "for(const rev of revisions){",
            "  const branchMeta=await core.localDatabase.getDBEntryMeta(path,{rev,revs:true},true);",
            "  const entry=await core.localDatabase.getDBEntry(path,{rev},false,true,true);",
            "  if(!branchMeta||!entry) throw new Error(`Could not read conflict revision: ${path} ${rev}`);",
            "  const content=Array.isArray(entry.data)?entry.data.join(''):entry.data;",
            "  if(typeof content!=='string') throw new Error(`Conflict revision was not text: ${path} ${rev}`);",
            "  const ids=branchMeta._revisions?.ids??[];",
            "  const parentRev=ids[1]?`${branchMeta._revisions.start-1}-${ids[1]}`:undefined;",
            "  branches.push({rev,parentRev,content,deleted:Boolean(branchMeta.deleted||branchMeta._deleted),path:branchMeta.path});",
            "}",
            "return JSON.stringify({currentRev:meta._rev,branches});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForFileConflict(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string
): Promise<FileConflictState> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000);
    let state = await readFileConflictState(cliBinary, env, path);
    while (state.branches.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        state = await readFileConflictState(cliBinary, env, path);
    }
    if (state.branches.length < 2) {
        throw new Error(`Timed out waiting for a file conflict: ${path}`);
    }
    return state;
}

async function waitForConflictBranch(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    predicate: (branch: FileConflictState["branches"][number]) => boolean
): Promise<FileConflictState["branches"][number]> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000);
    let state = await readFileConflictState(cliBinary, env, path);
    while (Date.now() < deadline) {
        const branch = state.branches.find(predicate);
        if (branch) return branch;
        await new Promise((resolve) => setTimeout(resolve, 250));
        state = await readFileConflictState(cliBinary, env, path);
    }
    throw new Error(`Timed out waiting for the expected conflict branch: ${path}; ${JSON.stringify(state)}`);
}

async function readFileReflectionProvenance(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string
): Promise<{ revision: string; observedStorageMtime?: number } | null> {
    return await evalObsidianJson<{ revision: string; observedStorageMtime?: number } | null>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const store=core.services.keyValueDB.openSimpleStore('file-reflection-provenance-v1');",
            "return JSON.stringify((await store.get(path))??null);",
            "})()",
        ].join(""),
        env
    );
}

async function readPathIdentity(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    paths: readonly string[]
): Promise<{ caseSensitive: boolean; ids: Record<string, string> }> {
    return await evalObsidianJson<{ caseSensitive: boolean; ids: Record<string, string> }>(
        cliBinary,
        [
            "(async()=>{",
            `const paths=${JSON.stringify(paths)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const ids={};",
            "for(const path of paths) ids[path]=await core.services.path.path2id(path);",
            "return JSON.stringify({",
            "  caseSensitive:Boolean(core.services.setting.currentSettings().handleFilenameCaseSensitive),",
            "  ids,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function calculateMarkdownAutoMerge(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<string> {
    const result = await evalObsidianJson<{ content: string }>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const result=await core.localDatabase.managers.conflictManager.tryAutoMerge(path,true);",
            "if(!('result' in result)){",
            "  throw new Error(`Markdown conflict was not auto-mergeable: ${path}; ${JSON.stringify(result)}`);",
            "}",
            "return JSON.stringify({content:result.result});",
            "})()",
        ].join(""),
        env
    );
    return result.content;
}

async function deleteRevisionAndReflect(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    revision: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const revision=${JSON.stringify(revision)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "if(!(await core.fileHandler.deleteRevisionFromDB(path,revision))){",
            "  throw new Error(`Could not delete conflicted revision: ${path} ${revision}`);",
            "}",
            "if(!(await core.fileHandler.dbToStorage(path,path,true))){",
            "  throw new Error(`Could not reflect merged Markdown content: ${path}`);",
            "}",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        env
    );
}

async function runCreateUpdateDelete(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const createdContent = "# Created on A\n\nThis note should appear on B.\n";
    let session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, createPath, createdContent);
    await uploadNote(context, session, createPath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    const createdOnB = await waitForPathContent(vaultB.path, createPath, (content) => content === createdContent);
    await stopTrackedSession(context, session);
    assertEqual(createdOnB, createdContent, "Created note did not round-trip to the second vault.");

    const initialUpdateContent = "# Update target\n\nInitial content.\n";
    const updatedContent = "# Update target\n\nUpdated content from A.\n";
    session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, updatePath, initialUpdateContent);
    await uploadNote(context, session, updatePath);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, updatePath, updatedContent);
    await uploadNote(context, session, updatePath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    const updatedOnB = await waitForPathContent(vaultB.path, updatePath, (content) => content === updatedContent);
    await stopTrackedSession(context, session);
    assertEqual(updatedOnB, updatedContent, "Updated note content did not round-trip to the second vault.");

    const deleteContent = "# Delete target\n\nThis note should be removed from B.\n";
    session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, deletePath, deleteContent);
    await uploadNote(context, session, deletePath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    await waitForPathContent(vaultB.path, deletePath, (content) => content === deleteContent);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultA);
    await deleteNoteViaObsidian(context.cliBinary, session.cliEnv, deletePath);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    await waitForPathDeleted(vaultB.path, deletePath);
    await stopTrackedSession(context, session);

    console.log("Two-vault note creation, update, and deletion round-tripped.");
}

async function runRename(context: RunnerContext, vaultA: TemporaryVault, vaultB: TemporaryVault): Promise<void> {
    const renamedContent = "# Rename target\n\nThis note should move from A to B.\n";

    let session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, renameFromPath, renamedContent);
    await uploadNote(context, session, renameFromPath);
    await renameNoteViaObsidian(context.cliBinary, session.cliEnv, renameFromPath, renameToPath);
    await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, renameToPath);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    const renamedOnB = await waitForPathContent(vaultB.path, renameToPath, (content) => content === renamedContent);
    await waitForPathDeleted(vaultB.path, renameFromPath);
    await stopTrackedSession(context, session);

    assertEqual(renamedOnB, renamedContent, "Renamed note content did not round-trip to the second vault.");
    console.log("Two-vault note rename round-tripped.");
}

async function runCaseOnlyRename(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const fileContent = "# Case-only rename\n\nThe document ID should remain live.\n";

    let session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, caseRenameFromPath, fileContent);
    await uploadNote(context, session, caseRenameFromPath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    await waitForPathContent(vaultB.path, caseRenameFromPath, (content) => content === fileContent);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultA);
    await renameNoteViaObsidian(context.cliBinary, session.cliEnv, caseRenameFromPath, caseRenameToPath);
    await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, caseRenameToPath);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    const renamedOnB = await waitForPathContent(vaultB.path, caseRenameToPath, (content) => content === fileContent);
    await waitForExactCaseOnlyRename(vaultB.path, caseRenameFromPath, caseRenameToPath);
    await stopTrackedSession(context, session);

    assertEqual(renamedOnB, fileContent, "Case-only note rename did not round-trip to the second vault.");
    console.log("Two-vault case-only note rename round-tripped without a tombstone.");
}

async function runEncryptedRoundTrip(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const encryptedContent = "# Encrypted round-trip\n\nThis note should synchronise with E2EE enabled.\n";
    const encryptedOverrides = {
        encrypt: true,
        passphrase: "real-obsidian-e2e-passphrase",
        usePathObfuscation: true,
        E2EEAlgorithm: "v2",
    };

    let session = await startConfiguredSession(context, vaultA, encryptedOverrides);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, encryptedPath, encryptedContent);
    await uploadNote(context, session, encryptedPath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, encryptedOverrides);
    await syncAndApply(context, session);
    const received = await waitForPathContent(vaultB.path, encryptedPath, (content) => content === encryptedContent);
    await stopTrackedSession(context, session);

    assertEqual(received, encryptedContent, "Encrypted note did not round-trip to the second vault.");
    console.log("Two-vault encrypted note synchronisation round-tripped.");
}

async function runMarkdownAutoMerge(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const base = "# Conflict\n\nTop anchor\n\nMiddle anchor\n\nBottom anchor\n";
    const left = "# Conflict\n\nTop anchor\n\nLeft line\n\nMiddle anchor\n\nBottom anchor\n";
    const right = "# Conflict\n\nTop anchor\n\nMiddle anchor\n\nRight tail\n\nBottom anchor\n";
    const conflictOverrides = {
        disableMarkdownAutoMerge: true,
        checkConflictOnlyOnOpen: true,
        showMergeDialogOnlyOnActive: true,
    };

    let session = await startConfiguredSession(context, vaultA, conflictOverrides);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, conflictPath, base);
    await uploadNote(context, session, conflictPath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, conflictOverrides);
    await syncAndApply(context, session);
    const baseOnB = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, conflictPath);
    await waitForPathContent(vaultB.path, conflictPath, (content) => content === base);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultA, conflictOverrides);
    const baseOnA = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, conflictPath);
    await storeFileRevision(context.cliBinary, session.cliEnv, conflictPath, left, baseOnA.rev);
    await writeVaultFile(vaultA.path, conflictPath, left);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, conflictOverrides);
    await storeFileRevision(context.cliBinary, session.cliEnv, conflictPath, right, baseOnB.rev);
    await writeVaultFile(vaultB.path, conflictPath, right);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    const conflict = await waitForFileConflict(context.cliBinary, session.cliEnv, conflictPath);
    const leftBranch = conflict.branches.find((branch) => branch.content === left);
    const rightBranch = conflict.branches.find((branch) => branch.content === right);
    if (!leftBranch || !rightBranch) {
        throw new Error(`The two Vault edits did not form the expected conflict: ${JSON.stringify(conflict)}`);
    }

    const merged = await calculateMarkdownAutoMerge(context.cliBinary, session.cliEnv, conflictPath);
    if (!merged.includes("Left line") || !merged.includes("Right tail")) {
        throw new Error(`Markdown auto-merge discarded a non-overlapping edit: ${JSON.stringify({ merged })}`);
    }
    const mergedRev = await storeFileRevision(context.cliBinary, session.cliEnv, conflictPath, merged, rightBranch.rev);
    await deleteRevisionAndReflect(context.cliBinary, session.cliEnv, conflictPath, leftBranch.rev);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    const mergedOnB = await waitForPathContent(
        vaultB.path,
        conflictPath,
        (content) => content === merged,
        Number(process.env.E2E_OBSIDIAN_MERGE_FILE_TIMEOUT_MS ?? 30000)
    );

    const afterResolution = `${merged.trimEnd()}\n\nPost-resolution edit on B.\n`;
    await storeFileRevision(context.cliBinary, session.cliEnv, conflictPath, afterResolution, mergedRev);
    await writeVaultFile(vaultB.path, conflictPath, afterResolution);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultA, conflictOverrides);
    await syncAndApply(context, session);
    const resolvedOnA = await waitForPathContent(
        vaultA.path,
        conflictPath,
        (content) => content === afterResolution,
        Number(process.env.E2E_OBSIDIAN_MERGE_FILE_TIMEOUT_MS ?? 30000)
    );
    const resolvedState = await readFileConflictState(context.cliBinary, session.cliEnv, conflictPath);
    await stopTrackedSession(context, session);

    assertEqual(mergedOnB, merged, "The resolving Vault did not reflect the merged Markdown content.");
    assertEqual(
        resolvedOnA,
        afterResolution,
        "The resolved Markdown content did not replace the known losing revision."
    );
    assertEqual(
        resolvedState.branches.length,
        1,
        "The receiving Vault recreated a conflict from the known losing revision."
    );
    console.log(
        "A two-Vault Markdown conflict was merged, edited again, and propagated to the Vault holding the resolved losing revision."
    );
}

async function runConflictTimeStorageOperations(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const paths = [conflictEditPath, conflictDeletePath, conflictCaseFromPath, conflictRenameFromPath] as const;
    const conflictOverrides = {
        disableMarkdownAutoMerge: true,
        checkConflictOnlyOnOpen: true,
        showMergeDialogOnlyOnActive: true,
        handleFilenameCaseSensitive: false,
    };
    const baseContent = Object.fromEntries(paths.map((path) => [path, `# Conflict operation\n\nBase for ${path}.\n`])) as Record<
        (typeof paths)[number],
        string
    >;
    const leftContent = Object.fromEntries(
        paths.map((path) => [path, `${baseContent[path]}\nEdit made on Vault A.\n`])
    ) as Record<(typeof paths)[number], string>;
    const rightContent = Object.fromEntries(
        paths.map((path) => [path, `${baseContent[path]}\nDisplayed edit made on Vault B.\n`])
    ) as Record<(typeof paths)[number], string>;

    let session = await startConfiguredSession(context, vaultA, conflictOverrides);
    for (const path of paths) {
        await writeNoteViaObsidian(context.cliBinary, session.cliEnv, path, baseContent[path]);
        await uploadNote(context, session, path);
    }
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, conflictOverrides);
    await syncAndApply(context, session);
    for (const path of paths) {
        await waitForPathContent(vaultB.path, path, (content) => content === baseContent[path]);
    }
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultA, conflictOverrides);
    for (const path of paths) {
        await writeNoteViaObsidian(context.cliBinary, session.cliEnv, path, leftContent[path]);
        await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path);
    }
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, conflictOverrides);
    for (const path of paths) {
        await writeNoteViaObsidian(context.cliBinary, session.cliEnv, path, rightContent[path]);
        await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path);
    }
    await pushLocalChanges(context.cliBinary, session.cliEnv);

    const displayedRevisions = new Map<string, string>();
    const initialBranchRevisions = new Map<string, Set<string>>();
    for (const path of paths) {
        const state = await waitForFileConflict(context.cliBinary, session.cliEnv, path);
        const displayedBranch = state.branches.find((branch) => branch.content === rightContent[path] && !branch.deleted);
        if (!displayedBranch) {
            throw new Error(`Could not identify the branch displayed by Vault B: ${path}; ${JSON.stringify(state)}`);
        }
        const provenance = await readFileReflectionProvenance(context.cliBinary, session.cliEnv, path);
        assertEqual(
            provenance?.revision,
            displayedBranch.rev,
            `Vault B did not retain the exact displayed revision for ${path}.`
        );
        displayedRevisions.set(path, displayedBranch.rev);
        initialBranchRevisions.set(path, new Set(state.branches.map((branch) => branch.rev)));
    }

    const editedAgain = `${rightContent[conflictEditPath]}\nSecond edit while the conflict is active.\n`;
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, conflictEditPath, editedAgain);
    const editedBranch = await waitForConflictBranch(
        context.cliBinary,
        session.cliEnv,
        conflictEditPath,
        (branch) => branch.content === editedAgain
    );
    assertEqual(
        editedBranch.parentRev,
        displayedRevisions.get(conflictEditPath),
        "A conflict-time edit did not extend the displayed revision."
    );

    await deleteNoteViaObsidian(context.cliBinary, session.cliEnv, conflictDeletePath);
    const deletedBranch = await waitForConflictBranch(
        context.cliBinary,
        session.cliEnv,
        conflictDeletePath,
        (branch) => branch.deleted
    );
    assertEqual(
        deletedBranch.parentRev,
        displayedRevisions.get(conflictDeletePath),
        "A conflict-time deletion did not extend the displayed revision."
    );

    await renameNoteViaObsidian(
        context.cliBinary,
        session.cliEnv,
        conflictCaseFromPath,
        conflictCaseToPath
    );
    const caseRenamedBranch = await waitForConflictBranch(
        context.cliBinary,
        session.cliEnv,
        conflictCaseToPath,
        (branch) =>
            !initialBranchRevisions.get(conflictCaseFromPath)?.has(branch.rev) &&
            branch.path === conflictCaseToPath &&
            branch.content === rightContent[conflictCaseFromPath] &&
            !branch.deleted
    );
    const expectedCaseParent = displayedRevisions.get(conflictCaseFromPath);
    if (caseRenamedBranch.parentRev !== expectedCaseParent) {
        const [state, oldProvenance, newProvenance, identity] = await Promise.all([
            readFileConflictState(context.cliBinary, session.cliEnv, conflictCaseToPath),
            readFileReflectionProvenance(context.cliBinary, session.cliEnv, conflictCaseFromPath),
            readFileReflectionProvenance(context.cliBinary, session.cliEnv, conflictCaseToPath),
            readPathIdentity(context.cliBinary, session.cliEnv, [conflictCaseFromPath, conflictCaseToPath]),
        ]);
        throw new Error(
            `A conflict-time case-only rename did not extend the displayed revision: ${JSON.stringify({
                expectedCaseParent,
                caseRenamedBranch,
                state,
                oldProvenance,
                newProvenance,
                identity,
            })}`
        );
    }
    const [oldCaseProvenance, newCaseProvenance] = await Promise.all([
        readFileReflectionProvenance(context.cliBinary, session.cliEnv, conflictCaseFromPath),
        readFileReflectionProvenance(context.cliBinary, session.cliEnv, conflictCaseToPath),
    ]);
    assertEqual(oldCaseProvenance, null, "A conflict-time case-only rename retained the old provenance path.");
    assertEqual(
        newCaseProvenance?.revision,
        caseRenamedBranch.rev,
        "A conflict-time case-only rename did not record the new displayed revision."
    );

    await renameNoteViaObsidian(
        context.cliBinary,
        session.cliEnv,
        conflictRenameFromPath,
        conflictRenameToPath
    );
    const renamedTarget = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, conflictRenameToPath);
    const renamedSourceDeletion = await waitForConflictBranch(
        context.cliBinary,
        session.cliEnv,
        conflictRenameFromPath,
        (branch) => branch.deleted
    );
    assertEqual(
        renamedSourceDeletion.parentRev,
        displayedRevisions.get(conflictRenameFromPath),
        "A conflict-time cross-path rename did not soft-delete the displayed source revision."
    );
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultA, conflictOverrides);
    await syncAndApply(context, session);
    const replicatedBranches = [
        [conflictEditPath, editedBranch],
        [conflictDeletePath, deletedBranch],
        [conflictCaseToPath, caseRenamedBranch],
        [conflictRenameFromPath, renamedSourceDeletion],
    ] as const;
    for (const [path, expectedBranch] of replicatedBranches) {
        const replicated = await waitForConflictBranch(
            context.cliBinary,
            session.cliEnv,
            path,
            (branch) => branch.rev === expectedBranch.rev
        );
        assertEqual(
            replicated.parentRev,
            expectedBranch.parentRev,
            `The exact conflict-operation revision tree did not replicate for ${path}.`
        );
    }
    await waitForPathContent(
        vaultA.path,
        conflictRenameToPath,
        (content) => content === rightContent[conflictRenameFromPath]
    );
    const targetOnA = await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, conflictRenameToPath);
    assertEqual(targetOnA.id, renamedTarget.id, "The cross-path rename target did not replicate as the same document.");
    assertEqual(
        await readVaultFile(vaultA.path, conflictDeletePath),
        leftContent[conflictDeletePath],
        "A logical deletion from one conflict branch removed the other Vault's live branch."
    );
    await stopTrackedSession(context, session);

    console.log(
        "Conflict-time edit, logical deletion, case-only rename, and cross-path rename extended the displayed branches and replicated their revision trees."
    );
}

async function runTargetMismatch(
    context: RunnerContext,
    vaultA: TemporaryVault,
    vaultB: TemporaryVault
): Promise<void> {
    const ignoredContent = "# Target mismatch\n\nB should ignore this revision.\n";
    const acceptedContent = "# Target mismatch\n\nB should accept this revision after its target filter changes.\n";

    let session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, targetMismatchPath, ignoredContent);
    await uploadNote(context, session, targetMismatchPath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, {
        syncOnlyRegEx: "^E2E/two-vault/allowed/.*",
    });
    await syncAndApply(context, session);
    await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, targetMismatchPath);
    assertEqual(
        await pathExists(vaultB.path, targetMismatchPath),
        false,
        "A note was reflected on a device where it was not a target file."
    );
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, {
        syncOnlyRegEx: "^E2E/two-vault/allowed/.*",
    });
    assertEqual(
        await pathExists(vaultB.path, targetMismatchPath),
        false,
        "A checkpointed non-target note was reflected before its target filter changed."
    );
    await configureCouchDb(
        context.cliBinary,
        session.cliEnv,
        {
            uri: context.couchDb.uri,
            username: context.couchDb.username,
            password: context.couchDb.password,
            dbName: context.dbName,
        },
        { syncOnlyRegEx: "" }
    );
    await syncAndApply(context, session);
    const reflectedAfterEnabling = await waitForPathContent(
        vaultB.path,
        targetMismatchPath,
        (content) => content === ignoredContent
    );
    await stopTrackedSession(context, session);

    assertEqual(
        reflectedAfterEnabling,
        ignoredContent,
        "Target file was not reflected after the device accepted the path."
    );

    session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, targetMismatchPath, acceptedContent);
    await uploadNote(context, session, targetMismatchPath);
    await stopTrackedSession(context, session);

    session = await startConfiguredSession(context, vaultB, {
        syncOnlyRegEx: "",
    });
    await syncAndApply(context, session);
    const received = await waitForPathContent(
        vaultB.path,
        targetMismatchPath,
        (content) => content === acceptedContent
    );
    await stopTrackedSession(context, session);

    assertEqual(received, acceptedContent, "Target file update was not reflected after the device accepted the path.");
    console.log(
        "Two-vault target mismatch skipped a non-target note, reflected it after enabling the target, and accepted a later update."
    );
}

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cli = discoverObsidianCli();
    if (!cli.binary) {
        throw new Error(`Could not find obsidian-cli. Checked paths: ${cli.checked.join(", ")}`);
    }

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "two-vault-sync");
    const encryptedDbName = makeUniqueDatabaseName(couchDb.dbPrefix, "two-vault-sync-e2ee");
    const vaultA = await createTemporaryVault();
    const vaultB = await createTemporaryVault();
    const encryptedVaultA = await createTemporaryVault();
    const encryptedVaultB = await createTemporaryVault();
    const context: RunnerContext = {
        binary,
        cliBinary: cli.binary,
        couchDb,
        dbName,
        reviewedVaults: new Set(),
        activeSessions: new Set(),
    };
    const encryptedContext: RunnerContext = {
        binary,
        cliBinary: cli.binary,
        couchDb,
        dbName: encryptedDbName,
        reviewedVaults: new Set(),
        activeSessions: new Set(),
    };

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        await createCouchDbDatabase(couchDb, encryptedDbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault A: ${vaultA.path}`);
        console.log(`Temporary vault B: ${vaultB.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);
        console.log(`Temporary encrypted CouchDB database: ${encryptedDbName}`);

        const onlyConflictOperations = process.env.E2E_OBSIDIAN_ONLY_CONFLICT_OPERATIONS === "true";
        if (!onlyConflictOperations) {
            await runCreateUpdateDelete(context, vaultA, vaultB);
            await runRename(context, vaultA, vaultB);
            await runCaseOnlyRename(context, vaultA, vaultB);
            if (process.env.E2E_OBSIDIAN_INCLUDE_MARKDOWN_CONFLICT === "true") {
                await runMarkdownAutoMerge(context, vaultA, vaultB);
            }
        }
        if (onlyConflictOperations || process.env.E2E_OBSIDIAN_INCLUDE_CONFLICT_OPERATIONS === "true") {
            await runConflictTimeStorageOperations(context, vaultA, vaultB);
        }
        if (!onlyConflictOperations) {
            await runTargetMismatch(context, vaultA, vaultB);
            await runEncryptedRoundTrip(encryptedContext, encryptedVaultA, encryptedVaultB);
        }
    } finally {
        await stopTrackedSessions(context);
        await stopTrackedSessions(encryptedContext);
        await vaultA.dispose();
        await vaultB.dispose();
        await encryptedVaultA.dispose();
        await encryptedVaultB.dispose();
        if (process.env.E2E_OBSIDIAN_KEEP_COUCHDB !== "true") {
            await deleteCouchDbDatabase(couchDb, dbName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
            await deleteCouchDbDatabase(couchDb, encryptedDbName).catch((error: unknown) => {
                console.warn(error instanceof Error ? error.message : error);
            });
        }
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
});
