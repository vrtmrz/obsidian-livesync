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
import { createTemporaryVault, type TemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";
process.env.E2E_OBSIDIAN_COUCHDB_TIMEOUT_MS ??= "20000";

const createPath = "E2E/two-vault/create.md";
const updatePath = "E2E/two-vault/update.md";
const deletePath = "E2E/two-vault/delete.md";
const renameFromPath = "E2E/two-vault/rename-source.md";
const renameToPath = "E2E/two-vault/renamed/rename-target.md";
const conflictPath = "E2E/two-vault/conflict.md";
const targetMismatchPath = "E2E/two-vault/target-mismatch.md";
const encryptedPath = "E2E/two-vault/encrypted.md";

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
        overrides
    );
    await waitForLiveSyncCoreReady(context.cliBinary, session.cliEnv);
    await prepareRemote(context.cliBinary, session.cliEnv);
    return session;
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

async function createMarkdownConflict(
    context: RunnerContext,
    session: ObsidianLiveSyncSession,
    vault: TemporaryVault,
    path: string,
    base: string,
    left: string,
    right: string
): Promise<void> {
    const baseRev = await storeFileRevision(context.cliBinary, session.cliEnv, path, base);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await waitForLocalDatabaseEntry(context.cliBinary, session.cliEnv, path);
    await storeFileRevision(context.cliBinary, session.cliEnv, path, left, baseRev);
    await storeFileRevision(context.cliBinary, session.cliEnv, path, right, baseRev);
    await writeVaultFile(vault.path, path, right);
}

async function autoMergeMarkdownConflict(cliBinary: string, env: NodeJS.ProcessEnv, path: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const result=await core.localDatabase.managers.conflictManager.tryAutoMerge(path,true);",
            "if(!('result' in result)){",
            "  throw new Error(`Markdown conflict was not auto-mergeable: ${path}; ${JSON.stringify(result)}`);",
            "}",
            "if(!(await core.databaseFileAccess.storeContent(path,result.result))){",
            "  throw new Error(`Could not store merged Markdown content: ${path}`);",
            "}",
            "if(!(await core.fileHandler.deleteRevisionFromDB(path,result.conflictedRev))){",
            "  throw new Error(`Could not delete conflicted revision: ${path}`);",
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
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    const createdOnB = await waitForPathContent(vaultB.path, createPath, (content) => content === createdContent);
    await session.app.stop();
    assertEqual(createdOnB, createdContent, "Created note did not round-trip to the second vault.");

    const initialUpdateContent = "# Update target\n\nInitial content.\n";
    const updatedContent = "# Update target\n\nUpdated content from A.\n";
    session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, updatePath, initialUpdateContent);
    await uploadNote(context, session, updatePath);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, updatePath, updatedContent);
    await uploadNote(context, session, updatePath);
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    const updatedOnB = await waitForPathContent(vaultB.path, updatePath, (content) => content === updatedContent);
    await session.app.stop();
    assertEqual(updatedOnB, updatedContent, "Updated note content did not round-trip to the second vault.");

    const deleteContent = "# Delete target\n\nThis note should be removed from B.\n";
    session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, deletePath, deleteContent);
    await uploadNote(context, session, deletePath);
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    await waitForPathContent(vaultB.path, deletePath, (content) => content === deleteContent);
    await session.app.stop();

    session = await startConfiguredSession(context, vaultA);
    await deleteNoteViaObsidian(context.cliBinary, session.cliEnv, deletePath);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    await waitForPathDeleted(vaultB.path, deletePath);
    await session.app.stop();

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
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB);
    await syncAndApply(context, session);
    const renamedOnB = await waitForPathContent(vaultB.path, renameToPath, (content) => content === renamedContent);
    await waitForPathDeleted(vaultB.path, renameFromPath);
    await session.app.stop();

    assertEqual(renamedOnB, renamedContent, "Renamed note content did not round-trip to the second vault.");
    console.log("Two-vault note rename round-tripped.");
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
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB, encryptedOverrides);
    await syncAndApply(context, session);
    const received = await waitForPathContent(vaultB.path, encryptedPath, (content) => content === encryptedContent);
    await session.app.stop();

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

    let session = await startConfiguredSession(context, vaultB);
    await createMarkdownConflict(context, session, vaultB, conflictPath, base, left, right);
    await autoMergeMarkdownConflict(context.cliBinary, session.cliEnv, conflictPath);
    await pushLocalChanges(context.cliBinary, session.cliEnv);
    const mergedOnB = await waitForPathContent(
        vaultB.path,
        conflictPath,
        (content) => content.includes("Left line") && content.includes("Right tail"),
        Number(process.env.E2E_OBSIDIAN_MERGE_FILE_TIMEOUT_MS ?? 30000)
    );
    await session.app.stop();

    session = await startConfiguredSession(context, vaultA);
    await syncAndApply(context, session);
    const mergedOnA = await waitForPathContent(
        vaultA.path,
        conflictPath,
        (content) => content.includes("Left line") && content.includes("Right tail"),
        Number(process.env.E2E_OBSIDIAN_MERGE_FILE_TIMEOUT_MS ?? 30000)
    );
    await session.app.stop();

    assertEqual(mergedOnA, mergedOnB, "Merged Markdown content was not consistent across both vaults.");
    console.log("Markdown conflict was automatically merged and propagated by the next synchronisation.");
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
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB, {
        syncOnlyRegEx: "^E2E/two-vault/allowed/.*",
    });
    await syncAndApply(context, session);
    assertEqual(
        await pathExists(vaultB.path, targetMismatchPath),
        false,
        "A note was reflected on a device where it was not a target file."
    );
    await session.app.stop();

    session = await startConfiguredSession(context, vaultA);
    await writeNoteViaObsidian(context.cliBinary, session.cliEnv, targetMismatchPath, acceptedContent);
    await uploadNote(context, session, targetMismatchPath);
    await session.app.stop();

    session = await startConfiguredSession(context, vaultB, {
        syncOnlyRegEx: "",
    });
    await syncAndApply(context, session);
    const received = await waitForPathContent(
        vaultB.path,
        targetMismatchPath,
        (content) => content === acceptedContent
    );
    await session.app.stop();

    assertEqual(received, acceptedContent, "Target file was not reflected after the device accepted the path.");
    console.log("Two-vault target mismatch skipped a non-target note, then reflected it after enabling the target.");
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
    const context: RunnerContext = { binary, cliBinary: cli.binary, couchDb, dbName };
    const encryptedContext: RunnerContext = { binary, cliBinary: cli.binary, couchDb, dbName: encryptedDbName };

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);
        await createCouchDbDatabase(couchDb, encryptedDbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault A: ${vaultA.path}`);
        console.log(`Temporary vault B: ${vaultB.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);
        console.log(`Temporary encrypted CouchDB database: ${encryptedDbName}`);

        await runCreateUpdateDelete(context, vaultA, vaultB);
        await runRename(context, vaultA, vaultB);
        if (process.env.E2E_OBSIDIAN_INCLUDE_MARKDOWN_CONFLICT === "true") {
            await runMarkdownAutoMerge(context, vaultA, vaultB);
        }
        await runTargetMismatch(context, vaultA, vaultB);
        await runEncryptedRoundTrip(encryptedContext, encryptedVaultA, encryptedVaultB);
    } finally {
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
