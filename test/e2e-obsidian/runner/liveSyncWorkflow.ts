import { evalObsidianJson } from "./cli.ts";
import { SERVICE_CONTEXT_MEMBERS } from "../../contracts/serviceContext.ts";
import { DATABASE_COMPATIBILITY_VERSION_KEY } from "../../../src/common/databaseCompatibility.ts";
import { CURRENT_SETTING_VERSION } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import { VER } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { CouchDbConfig } from "./couchdb.ts";
import type { ObjectStorageConfig } from "./objectStorage.ts";
import { captureObsidianDialogue, withObsidianPage } from "./ui.ts";

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

export type ReplicationAttempt = CoreReadiness & {
    succeeded: boolean;
    isOnline: boolean;
    activeReplicator: string;
    versionUpFlash: string;
    unresolvedMessages: unknown[];
};

export type CompatibilityMarkerState = {
    vaultName: string;
    additionalSuffix: string;
    expectedStorageKey: string;
    rawStorageValue: string | null;
    serviceValue: string;
    versionUpFlash: string;
};

export type ResumeCompatibilityReviewOptions = {
    verifyMissingDeviceMarkerExplanation?: boolean;
    screenshotPrefix?: string;
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

const E2E_PREFERRED_SETTINGS = {
    liveSync: false,
    syncOnStart: false,
    syncOnSave: false,
    usePluginSync: false,
    usePluginSyncV2: true,
    useEden: false,
    customChunkSize: 60,
    sendChunksBulk: false,
    sendChunksBulkMaxSize: 1,
    chunkSplitterVersion: "v3-rabin-karp",
    readChunksOnline: true,
    disableCheckingConfigMismatch: false,
    enableCompression: false,
    hashAlg: "xxhash64",
    handleFilenameCaseSensitive: false,
    doNotUseFixedRevisionForChunks: true,
    E2EEAlgorithm: "v2",
    doctorProcessedVersion: "0.25.27",
    settingVersion: CURRENT_SETTING_VERSION,
    isConfigured: true,
} as const;

export function createE2eObsidianDeviceLocalState(
    vaultName: string,
    additionalSuffixOfDatabaseName = ""
): Readonly<Record<string, string>> {
    return {
        [`${vaultName}-${additionalSuffixOfDatabaseName}-${DATABASE_COMPATIBILITY_VERSION_KEY}`]: `${VER}`,
    };
}

export async function readE2eCompatibilityMarker(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<CompatibilityMarkerState> {
    return await evalObsidianJson<CompatibilityMarkerState>(
        cliBinary,
        [
            "(()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const setting=core.services.setting;",
            "const settings=setting.currentSettings();",
            "const vaultName=core.services.API.getSystemVaultName();",
            `const markerKey=${JSON.stringify(DATABASE_COMPATIBILITY_VERSION_KEY)};`,
            "const additionalSuffix=`-${settings.additionalSuffixOfDatabaseName??''}`;",
            "const expectedStorageKey=`${vaultName}${additionalSuffix}-${markerKey}`;",
            "return JSON.stringify({",
            "vaultName,additionalSuffix,expectedStorageKey,",
            "rawStorageValue:localStorage.getItem(expectedStorageKey),",
            "serviceValue:setting.getSmallConfig(markerKey),",
            "versionUpFlash:settings.versionUpFlash,",
            "});",
            "})()",
        ].join(""),
        env
    );
}

export async function assertE2eCompatibilityMarker(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<CompatibilityMarkerState> {
    const state = await readE2eCompatibilityMarker(cliBinary, env);
    if (state.serviceValue !== `${VER}`) {
        throw new Error(
            `The E2E compatibility marker was not available on first plug-in load: ${JSON.stringify(state)}`
        );
    }
    return state;
}

export async function assertE2eCompatibilityReviewPending(
    cliBinary: string,
    env: NodeJS.ProcessEnv
): Promise<CompatibilityMarkerState> {
    const state = await readE2eCompatibilityMarker(cliBinary, env);
    if (state.serviceValue !== "" || state.rawStorageValue !== null || state.versionUpFlash === "") {
        throw new Error(`The copied-Vault compatibility review was not pending: ${JSON.stringify(state)}`);
    }
    return state;
}

export async function resumeCompatibilityReview(
    port: number,
    options: ResumeCompatibilityReviewOptions = {}
): Promise<void> {
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 10000);
    const title = "Synchronisation paused for compatibility review";
    const summaryLocator = (page: Parameters<Parameters<typeof withObsidianPage>[1]>[0]) =>
        page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: title }),
        });

    if (options.screenshotPrefix) {
        const summaryScreenshot = await captureObsidianDialogue(
            port,
            `${options.screenshotPrefix}-summary.png`,
            async (page) => {
                await summaryLocator(page).waitFor({ state: "visible", timeout: timeoutMs });
            }
        );
        console.log(`Compatibility review summary screenshot: ${summaryScreenshot}`);
    }

    if (options.verifyMissingDeviceMarkerExplanation === true) {
        await withObsidianPage(port, async (page) => {
            const summary = summaryLocator(page);
            await summary.waitFor({ state: "visible", timeout: timeoutMs });
            await summary.getByRole("button", { name: "Review compatibility details" }).click();
        });
        const detailsScreenshot = options.screenshotPrefix
            ? await captureObsidianDialogue(port, `${options.screenshotPrefix}-details.png`, async (page) => {
                  const details = page.locator(".modal-container").filter({
                      has: page.locator(".modal-title").filter({ hasText: "Compatibility review details" }),
                  });
                  await details.waitFor({ state: "visible", timeout: timeoutMs });
                  await details.getByText("copied or restored", { exact: false }).waitFor({
                      state: "visible",
                      timeout: timeoutMs,
                  });
                  await details.getByText("new Obsidian profile", { exact: false }).waitFor({
                      state: "visible",
                      timeout: timeoutMs,
                  });
                  await details
                      .getByText("does not mean that it is safe to resume automatically", { exact: false })
                      .waitFor({
                          state: "visible",
                          timeout: timeoutMs,
                      });
              })
            : undefined;
        if (detailsScreenshot) console.log(`Compatibility review details screenshot: ${detailsScreenshot}`);
        await withObsidianPage(port, async (page) => {
            const details = page.locator(".modal-container").filter({
                has: page.locator(".modal-title").filter({ hasText: "Compatibility review details" }),
            });
            await details.getByRole("button", { name: "Back to compatibility review" }).click();
            await summaryLocator(page).waitFor({ state: "visible", timeout: timeoutMs });
        });
    }

    await withObsidianPage(port, async (page) => {
        const summary = summaryLocator(page);
        await summary.waitFor({ state: "visible", timeout: timeoutMs });
        await summary.getByRole("button", { name: "Resume synchronisation" }).click();
        await summary.waitFor({ state: "hidden", timeout: timeoutMs });
    });
}

export function createE2eCouchDbPluginData(
    settings: Pick<CouchDbConfig, "uri" | "username" | "password"> & { dbName: string },
    overrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        couchDB_URI: settings.uri,
        couchDB_USER: settings.username,
        couchDB_PASSWORD: settings.password,
        couchDB_DBNAME: settings.dbName,
        remoteType: "",
        ...E2E_PREFERRED_SETTINGS,
        ...overrides,
    };
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
    const nextSettings = createE2eCouchDbPluginData(settings, overrides);
    return await evalObsidianJson<ConfiguredSettings>(
        cliBinary,
        [
            "(async()=>{",
            "const plugin=app.plugins.plugins['obsidian-livesync'];",
            "const core=plugin.core;",
            `const nextSettings=${JSON.stringify(nextSettings)};`,
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
    const nextSettings = {
        remoteType: "MINIO",
        endpoint: settings.endpoint,
        accessKey: settings.accessKey,
        secretKey: settings.secretKey,
        bucket: settings.bucket,
        region: settings.region,
        forcePathStyle: settings.forcePathStyle,
        bucketPrefix: settings.bucketPrefix,
        bucketCustomHeaders: "",
        ...E2E_PREFERRED_SETTINGS,
        ...overrides,
    };
    return await evalObsidianJson<ConfiguredSettings>(
        cliBinary,
        [
            "(async()=>{",
            "const plugin=app.plugins.plugins['obsidian-livesync'];",
            "const core=plugin.core;",
            `const nextSettings=${JSON.stringify(nextSettings)};`,
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
    const attempt = await evalObsidianJson<ReplicationAttempt>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const result=await core.services.replication.replicate(true);",
            "const settings=core.services.setting.currentSettings();",
            "const activeReplicator=core.services.replicator.getActiveReplicator();",
            "return JSON.stringify({",
            "succeeded:!!result,",
            "databaseReady:core.services.database.isDatabaseReady(),",
            "appReady:core.services.appLifecycle.isReady(),",
            "isOnline:core.services.API.isOnline,",
            "activeReplicator:activeReplicator?.constructor?.name??'(none)',",
            "versionUpFlash:settings.versionUpFlash,",
            "unresolvedMessages:(await core.services.appLifecycle.getUnresolvedMessages()).flat(),",
            "});",
            "})()",
        ].join(""),
        env
    );
    if (!attempt.succeeded) {
        throw new Error(`Finite replication did not start or complete: ${JSON.stringify(attempt)}`);
    }
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
