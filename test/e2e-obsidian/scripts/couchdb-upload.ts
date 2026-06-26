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
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

type ConfiguredSettings = {
    isConfigured: boolean;
    liveSync: boolean;
    syncOnStart: boolean;
    syncOnSave: boolean;
    couchDB_URI: string;
    couchDB_DBNAME: string;
};

type LocalDatabaseEntry = {
    id: string;
    path: string;
    type: string;
    children: string[];
};

type CoreReadiness = {
    databaseReady: boolean;
    appReady: boolean;
};

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

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

async function configureCouchDb(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    settings: {
        uri: string;
        username: string;
        password: string;
        dbName: string;
    }
): Promise<ConfiguredSettings> {
    return await evalObsidianJson<ConfiguredSettings>(
        cliBinary,
        [
            "(async()=>{",
            "const plugin=app.plugins.plugins['obsidian-livesync'];",
            "const core=plugin.core;",
            "const nextSettings={",
            `couchDB_URI:${JSON.stringify(settings.uri)},`,
            `couchDB_USER:${JSON.stringify(settings.username)},`,
            `couchDB_PASSWORD:${JSON.stringify(settings.password)},`,
            `couchDB_DBNAME:${JSON.stringify(settings.dbName)},`,
            "remoteType:'',",
            "liveSync:false,",
            "syncOnStart:false,",
            "syncOnSave:false,",
            "usePluginSync:false,",
            "usePluginSyncV2:true,",
            "useEden:false,",
            "customChunkSize:1,",
            "sendChunksBulkMaxSize:1,",
            "chunkSplitterVersion:'v3-rabin-karp',",
            "readChunksOnline:false,",
            "disableCheckingConfigMismatch:true,",
            "isConfigured:true,",
            "};",
            "await core.services.setting.applyExternalSettings(nextSettings,true);",
            "await core.services.control.applySettings();",
            "const current=core.services.setting.currentSettings();",
            "return JSON.stringify({",
            "isConfigured:current.isConfigured,",
            "liveSync:current.liveSync,",
            "syncOnStart:current.syncOnStart,",
            "syncOnSave:current.syncOnSave,",
            "couchDB_URI:current.couchDB_URI,",
            "couchDB_DBNAME:current.couchDB_DBNAME,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

async function waitForLiveSyncCoreReady(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS ?? 20000)
): Promise<CoreReadiness> {
    const deadline = Date.now() + timeoutMs;
    let lastReadiness: CoreReadiness | undefined;
    while (Date.now() < deadline) {
        lastReadiness = await evalObsidianJson<CoreReadiness>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "return JSON.stringify({",
                "databaseReady:core.services.database.isDatabaseReady(),",
                "appReady:core.services.appLifecycle.isReady(),",
                "});",
                "})()",
            ].join(""),
            env
        );
        if (lastReadiness.databaseReady && lastReadiness.appReady) {
            return lastReadiness;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for Self-hosted LiveSync core readiness: ${JSON.stringify(lastReadiness)}`);
}

async function prepareRemote(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const settings=core.services.setting.currentSettings();",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "await replicator.tryCreateRemoteDatabase(settings);",
            "await replicator.markRemoteResolved(settings);",
            "const status=await replicator.getRemoteStatus(settings);",
            "return JSON.stringify({status});",
            "})()",
        ].join(""),
        env
    );
}

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

async function pushLocalChanges(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const result=await core.services.replication.replicate(true);",
            "return JSON.stringify({result:!!result});",
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
