import { evalObsidianJson } from "./cli.ts";
import { SERVICE_CONTEXT_MEMBERS } from "../../contracts/serviceContext.ts";
import type { CouchDbConfig } from "./couchdb.ts";
import type { ObjectStorageConfig } from "./objectStorage.ts";

export type ConfiguredSettings = {
    isConfigured: boolean;
    liveSync: boolean;
    syncOnStart: boolean;
    syncOnSave: boolean;
    remoteType: string;
    couchDB_URI: string;
    couchDB_DBNAME: string;
    endpoint?: string;
    bucket?: string;
    bucketPrefix?: string;
};

export type CoreReadiness = {
    databaseReady: boolean;
    appReady: boolean;
};

export type ObsidianServiceContextContractResult = {
    contextType: string;
    eventResult: string[];
    translationResult: string;
    hubUsesContext: boolean;
    serviceContextMismatches: string[];
    appCapabilityMatches: boolean;
    pluginCapabilityMatches: boolean;
    liveSyncPluginCapabilityMatches: boolean;
};

export type LocalDatabaseEntry = {
    id: string;
    rev: string;
    path: string;
    type: string;
    children: string[];
};

function e2ePreferredSettingsSource(): string[] {
    return [
        "liveSync:false,",
        "syncOnStart:false,",
        "syncOnSave:false,",
        "usePluginSync:false,",
        "usePluginSyncV2:true,",
        "useEden:false,",
        "customChunkSize:60,",
        "sendChunksBulk:false,",
        "sendChunksBulkMaxSize:1,",
        "chunkSplitterVersion:'v3-rabin-karp',",
        "readChunksOnline:true,",
        "disableCheckingConfigMismatch:false,",
        "enableCompression:false,",
        "hashAlg:'xxhash64',",
        "handleFilenameCaseSensitive:false,",
        "doNotUseFixedRevisionForChunks:true,",
        "E2EEAlgorithm:'v2',",
        "doctorProcessedVersion:'0.25.27',",
        "isConfigured:true,",
    ];
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

export async function configureCouchDb(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    settings: Pick<CouchDbConfig, "uri" | "username" | "password"> & { dbName: string },
    overrides: Record<string, unknown> = {}
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
            ...e2ePreferredSettingsSource(),
            ...Object.entries(overrides).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)},`),
            "};",
            "await core.services.setting.applyExternalSettings(nextSettings,true);",
            "await core.services.control.applySettings();",
            "const current=core.services.setting.currentSettings();",
            "return JSON.stringify({",
            "isConfigured:current.isConfigured,",
            "liveSync:current.liveSync,",
            "syncOnStart:current.syncOnStart,",
            "syncOnSave:current.syncOnSave,",
            "remoteType:current.remoteType,",
            "couchDB_URI:current.couchDB_URI,",
            "couchDB_DBNAME:current.couchDB_DBNAME,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

export async function configureObjectStorage(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    settings: ObjectStorageConfig & { bucketPrefix: string },
    overrides: Record<string, unknown> = {}
): Promise<ConfiguredSettings> {
    return await evalObsidianJson<ConfiguredSettings>(
        cliBinary,
        [
            "(async()=>{",
            "const plugin=app.plugins.plugins['obsidian-livesync'];",
            "const core=plugin.core;",
            "const nextSettings={",
            "remoteType:'MINIO',",
            `endpoint:${JSON.stringify(settings.endpoint)},`,
            `accessKey:${JSON.stringify(settings.accessKey)},`,
            `secretKey:${JSON.stringify(settings.secretKey)},`,
            `bucket:${JSON.stringify(settings.bucket)},`,
            `region:${JSON.stringify(settings.region)},`,
            `forcePathStyle:${JSON.stringify(settings.forcePathStyle)},`,
            `bucketPrefix:${JSON.stringify(settings.bucketPrefix)},`,
            "bucketCustomHeaders:'',",
            ...e2ePreferredSettingsSource(),
            ...Object.entries(overrides).map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)},`),
            "};",
            "await core.services.setting.applyExternalSettings(nextSettings,true);",
            "await core.services.control.applySettings();",
            "const current=core.services.setting.currentSettings();",
            "return JSON.stringify({",
            "isConfigured:current.isConfigured,",
            "liveSync:current.liveSync,",
            "syncOnStart:current.syncOnStart,",
            "syncOnSave:current.syncOnSave,",
            "remoteType:current.remoteType,",
            "couchDB_URI:current.couchDB_URI,",
            "couchDB_DBNAME:current.couchDB_DBNAME,",
            "endpoint:current.endpoint,",
            "bucket:current.bucket,",
            "bucketPrefix:current.bucketPrefix,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

export async function waitForLiveSyncCoreReady(
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

/**
 * Inspect the actual Obsidian composition through Obsidian's CLI.
 *
 * This observes public Context results and verifies that the Hub and every
 * exposed service retain the exact Context created by the plug-in host.
 */
export async function inspectObsidianServiceContextContract(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<ObsidianServiceContextContractResult> {
    return await evalObsidianJson<ObsidianServiceContextContractResult>(
        cliBinary,
        [
            "(async()=>{",
            "const plugin=app.plugins.plugins['obsidian-livesync'];",
            "const services=plugin.core.services;",
            "const context=services.context;",
            `const serviceNames=${JSON.stringify(SERVICE_CONTEXT_MEMBERS)};`,
            "const eventResult=[];",
            "const unsubscribe=context.events.onEvent('hello',(value)=>eventResult.push(value));",
            "try{context.events.emitEvent('hello','context-contract-event');}finally{unsubscribe();}",
            "return JSON.stringify({",
            "contextType:context.constructor.name,",
            "eventResult,",
            "translationResult:context.translate('Replicator.Message.InitialiseFatalError'),",
            "hubUsesContext:services.context===context,",
            "serviceContextMismatches:serviceNames.filter((name)=>services[name].context!==context),",
            "appCapabilityMatches:context.app===app,",
            "pluginCapabilityMatches:context.plugin===plugin,",
            "liveSyncPluginCapabilityMatches:context.liveSyncPlugin===plugin,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

export function assertObsidianServiceContextContract(result: ObsidianServiceContextContractResult): void {
    assertEqual(result.contextType, "ObsidianServiceContext", "Unexpected Obsidian service Context type.");
    assertEqual(result.hubUsesContext, true, "The Obsidian Service Hub substituted its host Context.");
    assertEqual(
        result.serviceContextMismatches.length,
        0,
        `Services used a different Context: ${result.serviceContextMismatches.join(", ")}`
    );
    assertEqual(
        JSON.stringify(result.eventResult),
        JSON.stringify(["context-contract-event"]),
        "The Obsidian Context event API returned an unexpected result."
    );
    if (result.translationResult.length === 0) {
        throw new Error("The Obsidian Context translator returned an empty result.");
    }
    assertEqual(result.appCapabilityMatches, true, "The Obsidian Context lost its App capability.");
    assertEqual(result.pluginCapabilityMatches, true, "The Obsidian Context lost its Plugin capability.");
    assertEqual(
        result.liveSyncPluginCapabilityMatches,
        true,
        "The Obsidian Context lost its Self-hosted LiveSync plug-in capability."
    );
}

export async function prepareRemote(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
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

export async function pushLocalChanges(cliBinary: string, env: NodeJS.ProcessEnv): Promise<void> {
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

export async function waitForLocalDatabaseEntry(
    cliBinary: string,
    env: NodeJS.ProcessEnv,
    path: string,
    options: { hidden?: boolean; timeoutMs?: number } = {}
): Promise<LocalDatabaseEntry> {
    const timeoutMs = options.timeoutMs ?? Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000);
    return await evalObsidianJson<LocalDatabaseEntry>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const hidden=${JSON.stringify(options.hidden === true)};`,
            `const timeoutMs=${JSON.stringify(timeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const deadline=Date.now()+timeoutMs;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let entry=false;",
            "while(Date.now()<deadline){",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const dbPath=hidden?`i:${path}`:path;",
            "entry=await core.localDatabase.getDBEntry(dbPath,undefined,false,true).catch(()=>false);",
            "if(!entry||!entry._id){",
            "const rows=(await core.localDatabase.allDocsRaw({include_docs:true})).rows;",
            "entry=rows.map((row)=>row.doc).find((doc)=>doc&&(",
            "doc._id===dbPath||doc._id===path||doc.path===dbPath||doc.path===path||",
            "(typeof doc.path==='string'&&doc.path.endsWith(path))||",
            "(typeof doc._id==='string'&&doc._id.endsWith(path))",
            "))||false;",
            "}",
            "if(entry&&entry._id&&Array.isArray(entry.children)&&entry.children.length>0) break;",
            "await sleep(250);",
            "}",
            "if(!entry||!entry._id) throw new Error(`Timed out waiting for local database entry: ${path}`);",
            "return JSON.stringify({id:entry._id,rev:entry._rev,path:entry.path,type:entry.type,children:entry.children||[]});",
            "})()",
        ].join(""),
        env
    );
}
