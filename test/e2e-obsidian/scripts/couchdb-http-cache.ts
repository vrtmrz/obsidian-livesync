import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DoctorRegulation } from "@vrtmrz/livesync-commonlib/compat/common/configForDoc";
import { DOCID_SYNC_PARAMETERS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { evalObsidianJson } from "../runner/cli.ts";
import {
    assertCouchDbReachable,
    createCouchDbDatabase,
    deleteCouchDbDatabase,
    fetchAllCouchDbDocs,
    fetchCouchDbDocument,
    loadCouchDbConfig,
    makeUniqueDatabaseName,
    type CouchDbDocument,
} from "../runner/couchdb.ts";
import { requireObsidianBinary, requireObsidianCli } from "../runner/environment.ts";
import {
    configureCouchDb,
    createE2eCouchDbPluginData,
    createE2eObsidianDeviceLocalState,
    prepareRemote,
    pushLocalChanges,
    waitForLiveSyncCoreReady,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const customPath = ".obsidian/snippets/http-cache.css";
const nextCustomPath = ".obsidian/snippets/http-cache-new.css";
const settings = {
    encrypt: true,
    passphrase: "couchdb-http-cache-fixture-secret",
    idDerivationVersion: 0,
    usePathObfuscation: true,
    encryptInternalMetadata: false,
    usePluginSync: true,
    usePluginSyncV2: true,
    autoSweepPlugins: false,
    autoSweepPluginsPeriodic: false,
    syncInternalFiles: true,
    syncInternalFilesBeforeReplication: false,
    syncInternalFilesInterval: 0,
    syncInternalFilesTargetPatterns: "^\\.http-cache(?:/|$)",
    watchInternalFileChanges: false,
    useRequestAPI: false,
    autoAcceptCompatibleTweak: false,
    doctorProcessedVersion: DoctorRegulation.version,
    deviceAndVaultName: "http-cache-source",
};

async function main(): Promise<void> {
    const binary = requireObsidianBinary();
    const cliBinary = requireObsidianCli();
    const couchDb = await loadCouchDbConfig();
    await assertCouchDbReachable(couchDb);
    const dbName = makeUniqueDatabaseName(couchDb.dbPrefix, "http-cache");
    const connection = { ...couchDb, dbName };
    const vault = await createTemporaryVault();
    let session: ObsidianLiveSyncSession | undefined;
    const evaluate = async <T>(body: string): Promise<T> => {
        if (!session) throw new Error("No active Obsidian session.");
        return await evalObsidianJson<T>(
            cliBinary,
            `(async()=>{const core=app.plugins.plugins['obsidian-livesync'].core;${body}})()`,
            session.cliEnv
        );
    };
    const store = async (paths: string[]): Promise<void> => {
        await evaluate(`await core.getAddOn('HiddenFileSync').scanAllStorageChanges(true);
            for(const path of ${JSON.stringify(paths)}) await core.getAddOn('ConfigSync')
                .storeCustomizationFiles(path,core.services.setting.getDeviceAndVaultName());
            return JSON.stringify(true);`);
    };
    const browserRead = async (id: string, cache: RequestCache): Promise<CouchDbDocument> => {
        const url = `${couchDb.uri}/${encodeURIComponent(dbName)}/${encodeURIComponent(id)}`;
        const authorization = `Basic ${Buffer.from(`${couchDb.username}:${couchDb.password}`).toString("base64")}`;
        return await evaluate(`const response=await fetch(${JSON.stringify(url)},{
            headers:{authorization:${JSON.stringify(authorization)}},credentials:'include',cache:${JSON.stringify(cache)}});
            if(!response.ok)throw new Error('Fixture read failed: '+response.status);
            return JSON.stringify(await response.json());`);
    };

    try {
        await createCouchDbDatabase(couchDb, dbName);
        for (const path of ["example.md", ".http-cache/example.json", customPath]) {
            await mkdir(dirname(join(vault.path, path)), { recursive: true });
            await writeFile(join(vault.path, path), "/* HTTP cache fixture */\n");
        }
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            artifactRoot: resolve(process.env.E2E_OBSIDIAN_ARTIFACT_ROOT ?? "."),
            pluginData: createE2eCouchDbPluginData(connection, settings),
            localStorageEntries: createE2eObsidianDeviceLocalState(vault.name),
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        await configureCouchDb(cliBinary, session.cliEnv, connection, settings);
        await evaluate(`core.services.setting.setDeviceAndVaultName('http-cache-source');
            await core.services.setting.saveSettingData();return JSON.stringify(true);`);
        await prepareRemote(cliBinary, session.cliEnv);
        await store([customPath]);
        await pushLocalChanges(cliBinary, session.cliEnv);

        const initialRows = await fetchAllCouchDbDocs(couchDb, dbName);
        const original = initialRows.rows.find((row) => row.id.startsWith("f:"))?.doc;
        assert.ok(original?.path, "The encrypted ordinary Metadata fixture is missing.");
        const initialParameters = await fetchCouchDbDocument(couchDb, dbName, DOCID_SYNC_PARAMETERS);
        // Populate the HTTP cache as an earlier plug-in version would have done.
        assert.deepEqual(await browserRead(original._id, "reload"), original);

        await evaluate(`await core.services.setting.applyPartial({encryptInternalMetadata:true},true);
            await core.services.control.applySettings();
            await core.services.replicator.getActiveReplicator()
                .setPreferredRemoteTweakSettings(core.services.setting.currentSettings());
            return JSON.stringify(true);`);
        await writeFile(join(vault.path, nextCustomPath), "/* Protected internal Metadata */\n");
        await store([customPath, nextCustomPath]);
        await pushLocalChanges(cliBinary, session.cliEnv);

        // Maintenance Send rebuilds the remote while retaining local document revisions.
        await evaluate(`await core.rebuilder.performRemoteRebuild();return JSON.stringify(true);`);
        const rebuilt = await fetchCouchDbDocument(couchDb, dbName, original._id);
        const rebuiltParameters = await fetchCouchDbDocument(couchDb, dbName, DOCID_SYNC_PARAMETERS);
        assert.notEqual(rebuiltParameters.pbkdf2salt, initialParameters.pbkdf2salt, "The Seed did not change.");
        assert.equal(rebuilt._rev, original._rev, "The document revision was not retained.");
        assert.notEqual(rebuilt.path, original.path, "The remote ciphertext did not change.");
        assert.equal(
            (await browserRead(original._id, "default")).path,
            original.path,
            "The stale browser HTTP cache fixture is no longer present."
        );

        await evaluate(`await core.services.setting.applyPartial({usePluginSync:true,syncInternalFiles:true},true);
            await core.services.control.applySettings();return JSON.stringify(true);`);
        await store([customPath, nextCustomPath]);
        const admission = await evaluate<{ admitted: boolean; error?: string }>(`try {
            const opened=await core.services.replicator.getActiveReplicator()
                .checkReplicationConnectivity(core.services.setting.currentSettings(),false,false,true);
            if(opened)await opened.close();return JSON.stringify({admitted:!!opened});
            }catch(error){return JSON.stringify({admitted:false,error:error.name});}`);
        assert.ok(admission.admitted, `Replication admission failed: ${JSON.stringify(admission)}`);
        await pushLocalChanges(cliBinary, session.cliEnv);
        await pushLocalChanges(cliBinary, session.cliEnv);
        console.log("Rebuild and subsequent replication succeeded with stale ciphertext still in the HTTP cache.");
    } finally {
        await session?.app.stop();
        await vault.dispose();
        await deleteCouchDbDatabase(couchDb, dbName);
    }
}

await main();
