import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    waitForCouchDbDocs,
} from "../runner/couchdb.ts";
import { discoverObsidianCli, requireObsidianBinary } from "../runner/environment.ts";
import {
    assertEqual,
    configureCouchDb,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
    type LocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "30000";

const notePath = "E2E/couchdb-upload.md";
const noteContent = [
    "# CouchDB upload from real Obsidian",
    "",
    "This note is created through Obsidian and uploaded by Self-hosted LiveSync.",
    "The content is intentionally long enough to require chunk metadata in the local database.",
    "0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz",
    "0123456789 abcdefghijklmnopqrstuvwxyz 0123456789 abcdefghijklmnopqrstuvwxyz",
    `Created at: ${new Date().toISOString()}`,
    "",
].join("\n");

async function createNoteAndWaitForLocalDb(cliBinary: string, env: NodeJS.ProcessEnv): Promise<LocalDatabaseEntry> {
    return await evalObsidianJson<LocalDatabaseEntry>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(notePath)};`,
            `const content=${JSON.stringify(noteContent)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "if(!(await app.vault.adapter.exists('E2E'))) await app.vault.createFolder('E2E');",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.delete(existing);",
            "await app.vault.create(path,content);",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let entry=false;",
            "for(let i=0;i<40;i++){",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "entry=await core.localDatabase.getDBEntry(path,undefined,false,true).catch(()=>false);",
            "if(entry&&entry._id&&Array.isArray(entry.children)&&entry.children.length>0) break;",
            "await sleep(250);",
            "}",
            "if(!entry||!entry._id) throw new Error('Timed out waiting for local database entry');",
            "return JSON.stringify({id:entry._id,path:entry.path,type:entry.type,children:entry.children||[]});",
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

    const couchDb = await loadCouchDbConfig();
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "obsidian-upload");
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;

    try {
        await assertCouchDbReachable(couchDb);
        await createCouchDbDatabase(couchDb, dbName);

        console.log(`Using Obsidian executable: ${binary}`);
        console.log(`Temporary vault: ${vault.path}`);
        console.log(`Temporary CouchDB database: ${dbName}`);

        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary: cli.binary,
            vault,
            startupGraceMs: Number(process.env.E2E_OBSIDIAN_STARTUP_GRACE_MS ?? 1000),
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);

        const configured = await configureCouchDb(cli.binary, session.cliEnv, {
            uri: couchDb.uri,
            username: couchDb.username,
            password: couchDb.password,
            dbName,
        });
        await waitForLiveSyncCoreReady(cli.binary, session.cliEnv);
        assertEqual(configured.isConfigured, true, "Self-hosted LiveSync was not marked as configured.");
        assertEqual(configured.couchDB_URI, couchDb.uri, "Configured CouchDB URI did not match.");
        assertEqual(configured.couchDB_DBNAME, dbName, "Configured CouchDB database name did not match.");
        assertEqual(configured.liveSync, false, "LiveSync should remain disabled during this one-shot workflow.");
        assertEqual(configured.syncOnStart, false, "Sync on start should remain disabled during this workflow.");
        assertEqual(configured.syncOnSave, false, "Sync on save should remain disabled during this workflow.");

        await prepareRemote(cli.binary, session.cliEnv);
        const localEntry = await createNoteAndWaitForLocalDb(cli.binary, session.cliEnv);
        await pushLocalChanges(cli.binary, session.cliEnv);

        const remoteDocs = await waitForCouchDbDocs(couchDb, dbName, (docs) => {
            const ids = new Set(docs.map((doc) => doc._id));
            return ids.has(localEntry.id) && localEntry.children.every((childId) => ids.has(childId));
        });
        const remoteMetadata = remoteDocs.find((doc) => doc._id === localEntry.id);
        assertEqual(
            remoteMetadata?.path,
            localEntry.path,
            "Remote metadata path did not match the local database entry."
        );

        console.log(
            `Uploaded metadata ${localEntry.id} and ${localEntry.children.length} chunk(s) to CouchDB database ${dbName}`
        );
    } finally {
        if (session) {
            await session.app.stop();
        }
        await vault.dispose();
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
