import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
    waitForLocalDatabaseEntry,
} from "../runner/liveSyncWorkflow.ts";
import { startObsidianLiveSyncSession, type ObsidianLiveSyncSession } from "../runner/session.ts";
import { createTemporaryVault } from "../runner/vault.ts";
import { obsidianRemoteDebuggingPort, openLiveSyncSettings, withObsidianPage } from "../runner/ui.ts";

process.env.E2E_OBSIDIAN_CLI_TIMEOUT_MS ??= "60000";

const useRequestAPI = process.argv.includes("--request-api");
type ObservedRequest = { transport: string; method: string; url: string; cache?: RequestCache };
type RestartState = {
    settings: {
        useCouchDBCacheControlHeadersOnly: boolean;
        couchDB_DBNAME: string;
        deviceAndVaultName: string;
        encrypt: boolean;
        encryptInternalMetadata: boolean;
        usePathObfuscation: boolean;
    };
    localDatabaseName: string;
    localMetadata: null | { id: string; revision: string; path: string; children: string[] };
    nodeId: string;
};

async function waitForNextUnixSecond(previousUnixSecond: number): Promise<void> {
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_CORE_READY_TIMEOUT_MS ?? 20000);
    const deadline = Date.now() + timeoutMs;
    while (Math.floor(Date.now() / 1000) <= previousUnixSecond) {
        if (Date.now() >= deadline) {
            throw new Error("Timed out waiting for the next Unix second before restarting Obsidian.");
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

const customPath = ".obsidian/snippets/http-cache.css";
const nextCustomPath = ".obsidian/snippets/http-cache-new.css";
const ordinaryPath = "example.md";
const ordinaryContents = "/* HTTP cache fixture */\n";
const restartNotePath = "restart-after-http-cache.md";
const restartNoteContents = "Synchronised after restarting Obsidian.\n";
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
    useRequestAPI,
    usePowerUserMode: true,
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
    let observingRequests = false;
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
    const readCachedDocument = async (id: string, cache: RequestCache): Promise<CouchDbDocument> => {
        const url = `${couchDb.uri}/${encodeURIComponent(dbName)}/${encodeURIComponent(id)}`;
        const authorization = `Basic ${Buffer.from(`${couchDb.username}:${couchDb.password}`).toString("base64")}`;
        const fetchFunction = useRequestAPI ? "core.services.API.nativeFetch.bind(core.services.API)" : "fetch";
        return await evaluate(`const response=await ${fetchFunction}(${JSON.stringify(url)},{
            headers:{authorization:${JSON.stringify(authorization)}},credentials:'include',cache:${JSON.stringify(cache)}});
            if(!response.ok)throw new Error('Fixture read failed: '+response.status);
            return JSON.stringify(await response.json());`);
    };
    const observeCommonlibRequests = async (): Promise<void> => {
        await evaluate(`return (() => {
            const api=core.services.API;
            const state={requests:[],originals:{},restore:undefined};
            for(const name of ['webCompatFetch','nativeFetch']) {
                state.originals[name]=api[name];
                api[name]=function(request,options) {
                    const url=typeof request==='string'?request:request.url;
                    const method=options?.method??(typeof request==='string'?'GET':request.method);
                    state.requests.push({transport:name,method,url,cache:options?.cache});
                    return state.originals[name].call(this,request,options);
                };
            }
            state.restore=()=>{for(const name of Object.keys(state.originals)) api[name]=state.originals[name];};
            globalThis.couchDBHttpCacheObservations=state;
            return JSON.stringify(true);
        })()`);
        observingRequests = true;
    };
    const restoreCommonlibRequests = async (): Promise<void> => {
        await evaluate(`return (() => {
            const state=globalThis.couchDBHttpCacheObservations;
            if(state)state.restore();
            delete globalThis.couchDBHttpCacheObservations;
            return JSON.stringify(true);
        })()`);
        observingRequests = false;
    };
    const readCommonlibDocument = async (id: string) =>
        await evaluate<{
            document: CouchDbDocument;
            requests: ObservedRequest[];
        }>(`const state=globalThis.couchDBHttpCacheObservations;
            if(!state)throw new Error('HTTP request observation is not active');
            const firstRequest=state.requests.length;
            const replicator=core.services.replicator.getActiveReplicator();
            const connection=await replicator.connectRemoteCouchDBWithSetting(
                core.services.setting.currentSettings(),false,false,true);
            if(typeof connection==='string')throw new Error('Could not open the owned Commonlib connection: '+connection);
            try {
                const document=await connection.db.get(${JSON.stringify(id)});
                return JSON.stringify({document,requests:state.requests.slice(firstRequest)});
            } finally {
                await connection.close();
            }`);

    const metadataRequest = (
        read: Awaited<ReturnType<typeof readCommonlibDocument>>,
        id: string
    ): ObservedRequest => {
        const request = read.requests
            .filter((candidate) => {
                const path = new URL(candidate.url).pathname;
                return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) === id;
            })
            .slice(-1)[0];
        assert.ok(request, `The owned Commonlib read did not request Metadata ${id}.`);
        assert.equal(request.transport, useRequestAPI ? "nativeFetch" : "webCompatFetch");
        assert.equal(request.method.toUpperCase(), "GET");
        return request;
    };
    const setHeadersOnlyThroughUI = async (enabled: boolean, expectedBefore: boolean): Promise<void> => {
        await withObsidianPage(obsidianRemoteDebuggingPort(), async (page) => {
            const navigator = await openLiveSyncSettings(page);
            try {
                const pane = await navigator.openPage("Power users");
                const row = pane.locator(".setting-item").filter({
                    hasText: "Use headers only for HTTP cache control (compatibility)",
                });
                await row.waitFor({ state: "visible" });
                assert.equal(await row.locator(".checkbox-container.is-enabled").count(), Number(expectedBefore));
                await row.locator(".checkbox-container").click();
                await page.waitForFunction(
                    `app.plugins.plugins['obsidian-livesync'].core.services.setting.currentSettings().useCouchDBCacheControlHeadersOnly === ${enabled}`
                );
            } finally {
                await navigator.close();
            }
        });
        const saved = JSON.parse(await readFile(join(vault.path, ".obsidian/plugins/obsidian-livesync/data.json"), "utf8"));
        assert.equal(saved.useCouchDBCacheControlHeadersOnly, enabled, "The compatibility switch was not saved.");
    };
    const assertLogicalDocument = (document: CouchDbDocument, original: CouchDbDocument): void => {
        assert.equal(document._id, original._id);
        assert.equal(document._rev, original._rev, "The logical Metadata revision changed.");
        assert.equal(document.path, ordinaryPath, "The owned connection did not return the logical file path.");
        assert.equal(document.type, original.type);
        assert.equal(document.size, Buffer.byteLength(ordinaryContents));
        assert.ok(Array.isArray(document.children) && document.children.length > 0);
    };
    const readRestartState = async (): Promise<RestartState> =>
        await evaluate<RestartState>([
            "const settings=core.services.setting.currentSettings();",
            "const database=core.localDatabase.localDatabase;",
            "const databaseInfo=await database.info();",
            "const nodeInfo=await database.get('_local/obsydian_livesync_nodeinfo').catch(()=>null);",
            "const localMetadata=await core.localDatabase.getDBEntry('example.md',undefined,false,true).catch(()=>null);",
            "return JSON.stringify({settings:{",
            "useCouchDBCacheControlHeadersOnly:settings.useCouchDBCacheControlHeadersOnly===true,",
            "couchDB_DBNAME:settings.couchDB_DBNAME,deviceAndVaultName:core.services.setting.getDeviceAndVaultName(),",
            "encrypt:settings.encrypt,encryptInternalMetadata:settings.encryptInternalMetadata,",
            "usePathObfuscation:settings.usePathObfuscation},",
            "localDatabaseName:databaseInfo.db_name,",
            "localMetadata:localMetadata?{id:localMetadata._id,revision:localMetadata._rev,path:localMetadata.path,children:localMetadata.children??[]}:null,",
            "nodeId:nodeInfo?.nodeid??''});",
        ].join(""));

    try {
        await createCouchDbDatabase(couchDb, dbName);
        for (const path of [ordinaryPath, ".http-cache/example.json", customPath]) {
            await mkdir(dirname(join(vault.path, path)), { recursive: true });
            await writeFile(join(vault.path, path), ordinaryContents);
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
        assert.deepEqual(await readCachedDocument(original._id, "reload"), original);
        await observeCommonlibRequests();
        const initialRead = await readCommonlibDocument(original._id);
        assertLogicalDocument(initialRead.document, original);
        const initialMetadataRequest = metadataRequest(initialRead, original._id);
        const initialEpoch = new URL(initialMetadataRequest.url).searchParams.get("_livesync_epoch");
        assert.ok(initialEpoch, "The ordinary Metadata read did not include a Seed cache namespace.");
        assert.match(initialEpoch, /^[0-9a-f]{64}$/, "The URL must contain only the combined hash.");

        await setHeadersOnlyThroughUI(true, false);
        const compatibilityRead = await readCommonlibDocument(original._id);
        assertLogicalDocument(compatibilityRead.document, original);
        const compatibilityRequest = metadataRequest(compatibilityRead, original._id);
        assert.equal(new URL(compatibilityRequest.url).searchParams.has("_livesync_epoch"), false);
        assert.equal(compatibilityRequest.cache, "no-store");

        await setHeadersOnlyThroughUI(false, true);
        const restoredRead = await readCommonlibDocument(original._id);
        assertLogicalDocument(restoredRead.document, original);
        const restoredRequest = metadataRequest(restoredRead, original._id);
        assert.equal(new URL(restoredRequest.url).searchParams.get("_livesync_epoch"), initialEpoch);
        assert.equal(restoredRequest.cache, "no-cache");

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
        if (!useRequestAPI) {
            assert.equal(
                (await readCachedDocument(original._id, "default")).path,
                original.path,
                "The stale browser HTTP cache fixture is no longer present."
            );
        }
        const rebuiltRead = await readCommonlibDocument(original._id);
        assertLogicalDocument(rebuiltRead.document, original);
        assert.deepEqual(
            rebuiltRead.document.children,
            initialRead.document.children,
            "The logical file content references changed during Rebuild."
        );
        const rebuiltMetadataRequest = metadataRequest(rebuiltRead, original._id);
        const rebuiltEpoch = new URL(rebuiltMetadataRequest.url).searchParams.get("_livesync_epoch");
        assert.ok(rebuiltEpoch, "The post-Rebuild Metadata read did not include a Seed cache namespace.");
        assert.notEqual(rebuiltEpoch, initialEpoch, "The cache namespace did not change with the Security Seed.");

        await evaluate(`await core.services.setting.applyPartial({usePluginSync:true,syncInternalFiles:true},true);
            await core.services.control.applySettings();return JSON.stringify(true);`);
        await store([customPath, nextCustomPath]);
        const admission = await evaluate<{ admitted: boolean; error?: string }>(`try {
            const opened=await core.services.replicator.getActiveReplicator()
                .checkReplicationConnectivity(core.services.setting.currentSettings(),false,false,true);
            if(opened)await opened.close();return JSON.stringify({admitted:!!opened});
            }catch(error){return JSON.stringify({admitted:false,error:error.name});}`);
        assert.ok(admission.admitted, `Replication admission failed: ${JSON.stringify(admission)}`);
        const repeatedRead = await readCommonlibDocument(original._id);
        assertLogicalDocument(repeatedRead.document, original);
        assert.deepEqual(
            repeatedRead.document.children,
            initialRead.document.children,
            "The logical file content references changed after replication admission."
        );
        const repeatedMetadataRequest = metadataRequest(repeatedRead, original._id);
        const repeatedEpoch = new URL(repeatedMetadataRequest.url).searchParams.get("_livesync_epoch");
        assert.equal(
            repeatedEpoch,
            rebuiltEpoch,
            "A new connection at the same Seed did not reuse its cache namespace."
        );
        await pushLocalChanges(cliBinary, session.cliEnv);
        await pushLocalChanges(cliBinary, session.cliEnv);
        // Include Chunk bodies for strict reconciliation after replacing the local database.
        await evaluate(
            `await core.services.setting.applyPartial({readChunksOnline:false},true);return JSON.stringify(true);`
        );
        const fetchAttempt = await evaluate<{ succeeded: boolean; error?: string; diagnostics?: unknown }>(`try {
            await core.rebuilder.fetchLocal(false,true);return JSON.stringify({succeeded:true});
            } catch(error) {
                await core.services.API.showWindow('log-log');
                await new Promise(resolve=>setTimeout(resolve,100));
                const log=Array.from(document.querySelectorAll('.logpane .log pre')).map(e=>e.textContent??'').join('\\n').slice(-16000);
                return JSON.stringify({succeeded:false,error:String(error),diagnostics:{
                    databaseReady:core.services.database.isDatabaseReady(),appReady:core.services.appLifecycle.isReady(),
                    unresolvedMessages:(await core.services.appLifecycle.getUnresolvedMessages()).flat(),log}});
            }`);
        assert.ok(fetchAttempt.succeeded, `Standard Fetch failed: ${JSON.stringify(fetchAttempt)}`);
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const fetchedRead = await readCommonlibDocument(original._id);
        assertLogicalDocument(fetchedRead.document, original);
        assert.deepEqual(fetchedRead.document.children, initialRead.document.children);
        assert.equal(
            new URL(metadataRequest(fetchedRead, original._id).url).searchParams.get("_livesync_epoch"),
            rebuiltEpoch
        );
        assert.equal(await readFile(join(vault.path, ordinaryPath), "utf8"), ordinaryContents);
        await pushLocalChanges(cliBinary, session.cliEnv);

        const remoteBeforeRestart = await fetchCouchDbDocument(couchDb, dbName, original._id);
        const seedBeforeRestart = await fetchCouchDbDocument(couchDb, dbName, DOCID_SYNC_PARAMETERS);
        assert.equal(remoteBeforeRestart._rev, rebuilt._rev, "The Metadata revision changed before restart.");
        assert.equal(remoteBeforeRestart.path, rebuilt.path, "The remote Metadata ciphertext changed before restart.");
        assert.equal(
            seedBeforeRestart.pbkdf2salt,
            rebuiltParameters.pbkdf2salt,
            "The Security Seed changed before restart."
        );
        const stateBeforeRestart = await readRestartState();
        assert.equal(stateBeforeRestart.settings.useCouchDBCacheControlHeadersOnly, false);
        assert.equal(stateBeforeRestart.settings.couchDB_DBNAME, dbName);
        assert.equal(stateBeforeRestart.settings.deviceAndVaultName, "http-cache-source");
        assert.equal(stateBeforeRestart.settings.encrypt, true);
        assert.equal(stateBeforeRestart.settings.encryptInternalMetadata, true);
        assert.equal(stateBeforeRestart.settings.usePathObfuscation, true);
        assert.equal(stateBeforeRestart.localMetadata?.path, ordinaryPath);
        assert.ok(stateBeforeRestart.nodeId, "The device identity was not persisted before restart.");

        const previousUnixSecond = Math.floor(Date.now() / 1000);
        await restoreCommonlibRequests();
        if (!session) throw new Error("No active Obsidian session to stop.");
        await session.app.stop();
        session = undefined;
        await waitForNextUnixSecond(previousUnixSecond);

        // Reuse the same Vault and isolated profile. Do not reseed settings or local device state.
        session = await startObsidianLiveSyncSession({
            binary,
            cliBinary,
            vault,
            artifactRoot: resolve(process.env.E2E_OBSIDIAN_ARTIFACT_ROOT ?? "."),
            pluginStartup: "natural",
        });
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const stateAfterRestart = await readRestartState();
        assert.deepEqual(stateAfterRestart.settings, stateBeforeRestart.settings);
        assert.equal(stateAfterRestart.localDatabaseName, stateBeforeRestart.localDatabaseName);
        assert.deepEqual(stateAfterRestart.localMetadata, stateBeforeRestart.localMetadata);
        assert.equal(stateAfterRestart.nodeId, stateBeforeRestart.nodeId, "Restart changed the persisted device identity.");

        const remoteAfterRestart = await fetchCouchDbDocument(couchDb, dbName, original._id);
        const seedAfterRestart = await fetchCouchDbDocument(couchDb, dbName, DOCID_SYNC_PARAMETERS);
        assert.equal(remoteAfterRestart._rev, remoteBeforeRestart._rev, "Restart changed the remote Metadata revision.");
        assert.equal(
            remoteAfterRestart.path,
            remoteBeforeRestart.path,
            "Restart changed the remote Metadata ciphertext."
        );
        assert.equal(seedAfterRestart.pbkdf2salt, seedBeforeRestart.pbkdf2salt, "Restart changed the Security Seed.");
        assert.equal(await readFile(join(vault.path, ordinaryPath), "utf8"), ordinaryContents);
        if (!useRequestAPI) {
            assert.equal(
                (await readCachedDocument(original._id, "default")).path,
                original.path,
                "The isolated browser HTTP cache did not survive the application restart."
            );
        }

        await observeCommonlibRequests();
        const restartedRead = await readCommonlibDocument(original._id);
        assertLogicalDocument(restartedRead.document, original);
        assert.deepEqual(restartedRead.document.children, initialRead.document.children);
        const restartedMetadataRequest = metadataRequest(restartedRead, original._id);
        const restartedEpoch = new URL(restartedMetadataRequest.url).searchParams.get("_livesync_epoch");
        assert.ok(restartedEpoch, "The restarted Metadata read did not include a cache namespace.");
        assert.match(restartedEpoch, /^[0-9a-f]{64}$/, "The restarted URL must contain only the combined hash.");
        assert.notEqual(
            restartedEpoch,
            rebuiltEpoch,
            "A full application restart reused its earlier non-compatibility cache namespace."
        );
        assert.equal(restartedMetadataRequest.cache, "no-cache");

        await evaluate("await core.services.setting.applyPartial({readChunksOnline:false},true);return JSON.stringify(true);");
        const restartedFetchAttempt = await evaluate<{ succeeded: boolean; error?: string }>([
            "try{await core.rebuilder.fetchLocal(false,true);return JSON.stringify({succeeded:true});}",
            "catch(error){return JSON.stringify({succeeded:false,error:String(error)});}",
        ].join(""));
        assert.ok(
            restartedFetchAttempt.succeeded,
            `Standard Fetch after restart failed: ${JSON.stringify(restartedFetchAttempt)}`
        );
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const afterRestartFetch = await readCommonlibDocument(original._id);
        assertLogicalDocument(afterRestartFetch.document, original);
        assert.deepEqual(afterRestartFetch.document.children, initialRead.document.children);
        assert.equal(
            new URL(metadataRequest(afterRestartFetch, original._id).url).searchParams.get("_livesync_epoch"),
            restartedEpoch,
            "Standard Fetch changed the restarted cache namespace."
        );
        assert.equal(await readFile(join(vault.path, ordinaryPath), "utf8"), ordinaryContents);
        const remoteAfterRestartFetch = await fetchCouchDbDocument(couchDb, dbName, original._id);
        const seedAfterRestartFetch = await fetchCouchDbDocument(couchDb, dbName, DOCID_SYNC_PARAMETERS);
        assert.equal(remoteAfterRestartFetch._rev, remoteBeforeRestart._rev);
        assert.equal(remoteAfterRestartFetch.path, remoteBeforeRestart.path);
        assert.equal(seedAfterRestartFetch.pbkdf2salt, seedBeforeRestart.pbkdf2salt);

        await writeFile(join(vault.path, restartNotePath), restartNoteContents);
        const restartNoteEntry = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, restartNotePath);
        assert.equal(restartNoteEntry.path, restartNotePath);
        await pushLocalChanges(cliBinary, session.cliEnv);
        const uploadedRestartNote = await readCommonlibDocument(restartNoteEntry.id);
        assert.equal(uploadedRestartNote.document.path, restartNotePath);
        assert.equal(uploadedRestartNote.document.size, Buffer.byteLength(restartNoteContents));
        assert.ok(
            Array.isArray(uploadedRestartNote.document.children) && uploadedRestartNote.document.children.length > 0
        );
        assert.equal(
            new URL(metadataRequest(uploadedRestartNote, restartNoteEntry.id).url).searchParams.get("_livesync_epoch"),
            restartedEpoch,
            "Subsequent synchronisation did not use the restarted cache namespace."
        );
        assert.equal(await readFile(join(vault.path, restartNotePath), "utf8"), restartNoteContents);
        const originalAfterRestartSync = await fetchCouchDbDocument(couchDb, dbName, original._id);
        assert.equal(originalAfterRestartSync._rev, remoteBeforeRestart._rev);
        assert.equal(originalAfterRestartSync.path, remoteBeforeRestart.path);
        const uploadedRestartNoteRemote = await fetchCouchDbDocument(couchDb, dbName, restartNoteEntry.id);

        await evaluate("await core.services.setting.applyPartial({readChunksOnline:false},true);return JSON.stringify(true);");
        const uploadVerificationFetch = await evaluate<{ succeeded: boolean; error?: string }>([
            "try{await core.rebuilder.fetchLocal(false,true);return JSON.stringify({succeeded:true});}",
            "catch(error){return JSON.stringify({succeeded:false,error:String(error)});}",
        ].join(""));
        assert.ok(
            uploadVerificationFetch.succeeded,
            `Standard Fetch after the upload failed: ${JSON.stringify(uploadVerificationFetch)}`
        );
        await waitForLiveSyncCoreReady(cliBinary, session.cliEnv);
        const fetchedRestartNoteEntry = await waitForLocalDatabaseEntry(cliBinary, session.cliEnv, restartNotePath);
        assert.equal(fetchedRestartNoteEntry.id, restartNoteEntry.id);
        assert.equal(fetchedRestartNoteEntry.rev, uploadedRestartNote.document._rev);
        assert.deepEqual(fetchedRestartNoteEntry.children, uploadedRestartNote.document.children);
        const fetchedRestartNoteBody = await evaluate<string>([
            "const file=await core.serviceModules.databaseFileAccess.fetch(" + JSON.stringify(restartNotePath) + ");",
            "if(!file||file.deleted||!file.body)throw new Error('The uploaded note was not readable from the replaced local database.');",
            "return JSON.stringify(await file.body.text());",
        ].join(""));
        assert.equal(
            fetchedRestartNoteBody,
            restartNoteContents,
            "The replaced local database did not return the exact uploaded Chunk content."
        );
        const fetchedRestartNote = await readCommonlibDocument(restartNoteEntry.id);
        assert.equal(fetchedRestartNote.document.path, restartNotePath);
        assert.equal(fetchedRestartNote.document.size, Buffer.byteLength(restartNoteContents));
        assert.equal(fetchedRestartNote.document._rev, uploadedRestartNote.document._rev);
        assert.deepEqual(fetchedRestartNote.document.children, uploadedRestartNote.document.children);
        assert.equal(
            new URL(metadataRequest(fetchedRestartNote, restartNoteEntry.id).url).searchParams.get("_livesync_epoch"),
            restartedEpoch,
            "Standard Fetch after the upload changed the restarted cache namespace."
        );
        assert.equal(await readFile(join(vault.path, restartNotePath), "utf8"), restartNoteContents);
        assert.equal(await readFile(join(vault.path, ordinaryPath), "utf8"), ordinaryContents);
        const restartNoteAfterFetch = await fetchCouchDbDocument(couchDb, dbName, restartNoteEntry.id);
        assert.equal(restartNoteAfterFetch._rev, uploadedRestartNoteRemote._rev);
        assert.equal(restartNoteAfterFetch.path, uploadedRestartNoteRemote.path);
        const originalAfterUploadFetch = await fetchCouchDbDocument(couchDb, dbName, original._id);
        const seedAfterUploadFetch = await fetchCouchDbDocument(couchDb, dbName, DOCID_SYNC_PARAMETERS);
        assert.equal(originalAfterUploadFetch._rev, remoteBeforeRestart._rev);
        assert.equal(originalAfterUploadFetch.path, remoteBeforeRestart.path);
        assert.equal(seedAfterUploadFetch.pbkdf2salt, seedBeforeRestart.pbkdf2salt);

        await restoreCommonlibRequests();
        console.log(
            `Cache compatibility switch persistence, Rebuild, Standard Fetch, and subsequent replication succeeded with the ${useRequestAPI ? "Internal API" : "browser"} HTTP cache.`
        );
        console.log(
            `Full application restart on the same Vault and profile retained device identity, ` +
                `changed the cache namespace, and passed post-restart Fetch and upload (${useRequestAPI ? "Internal API" : "browser"}).`
        );
    } finally {
        if (observingRequests && session) {
            try {
                await restoreCommonlibRequests();
            } catch {
                // The isolated Obsidian process is stopped immediately below.
            }
        }
        await session?.app.stop();
        await vault.dispose();
        await deleteCouchDbDatabase(couchDb, dbName);
    }
}

await main();
