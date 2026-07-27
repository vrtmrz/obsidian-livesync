import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { evalObsidianJson } from "./cli.ts";
import type { CouchDbConfig } from "./couchdb.ts";
import type { ObjectStorageConfig } from "./objectStorage.ts";
import { withObsidianPage } from "./ui.ts";
import type {
    CouchDbCheckpointSnapshot,
    JournalCheckpointSnapshot,
    JournalIoObservation,
} from "./upgradeContinuity.ts";
import { waitForLocalDatabaseEntry } from "./liveSyncWorkflow.ts";
import type { TemporaryVault } from "./vault.ts";

export const STABLE_RELEASE_VERSION = "0.25.83";

export type UpgradeTransportConfiguration =
    | {
          kind: "couchdb";
          config: CouchDbConfig;
          databaseName: string;
      }
    | {
          kind: "object-storage";
          config: ObjectStorageConfig;
          bucketPrefix: string;
      };

export type UpgradeScenarioPaths = {
    original: string;
    renamed: string;
    deleted: string;
    postUpgrade: string;
    returnFromVerifier: string;
};

export type RuntimeUpgradeState = {
    pluginVersion: string;
    vaultName: string;
    localDatabaseName: string;
    localDatabaseUpdateSequence: number | string;
    localDatabaseDocumentCount: number;
    nodeId: string;
    legacyCompatibilityMarker: string | null;
    compatibilityMarker: string;
    compatibilityStorageEntries: Record<string, string>;
    migrationState?: {
        sourceVersion: number;
        targetVersion: number;
        isNewVault: boolean;
        isFromFutureSchema: boolean;
        changed: boolean;
        requiresSyncReview: boolean;
        reviewReasons: Array<{ code: string; fromVersion: number; toVersion: number }>;
    };
    settings: {
        isConfigured: boolean | undefined;
        settingVersion: number;
        versionUpFlash: string;
        liveSync: boolean;
        syncOnStart: boolean;
        syncOnSave: boolean;
        syncOnEditorSave: boolean;
        syncOnFileOpen: boolean;
        syncAfterMerge: boolean;
        periodicReplication: boolean;
        encrypt: boolean;
        usePathObfuscation: boolean;
        syncInternalFiles: boolean;
        customChunkSize: number;
        usePluginSyncV2: boolean;
        enableCompression: boolean;
        useEden: boolean;
        filenameCaseType: string;
        handleFilenameCaseSensitive?: boolean;
        doNotUseFixedRevisionForChunks: boolean;
        chunkSplitterVersion: string;
        E2EEAlgorithm: string;
        additionalSuffixOfDatabaseName: string;
        remoteType: string;
        couchDB_DBNAME: string;
        endpoint: string;
        bucket: string;
        bucketPrefix: string;
        activeConfigurationId: string;
        remoteConfigurationIds: string[];
        doctorProcessedVersion: string;
    };
};

export type RuntimeSettingsUpgradeState = Pick<RuntimeUpgradeState, "pluginVersion" | "migrationState" | "settings"> & {
    compatibilityMarker: string;
};

export type CouchDbReplicationObservation = {
    succeeded: boolean;
    sentDocuments: number;
    arrivedDocuments: number;
};

export type JournalReplicationObservation = JournalIoObservation & {
    succeeded: boolean;
};

const firstContent = "# Stable release history\n\nCreated before the 1.0 upgrade.\n";
const editedContent = "# Stable release history\n\nEdited and renamed before the 1.0 upgrade.\n";
const deletedContent = "# Deleted before upgrade\n\nThis note must not be resurrected.\n";
const postUpgradeContent = "# Post-upgrade delta\n\nCreated by the upgraded 1.0 device.\n";
const returnContent = "# Return journey\n\nCreated by a fresh 1.0 verifier device.\n";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: ${String(expected)}\nActual: ${String(actual)}`);
    }
}

function assertStringArraysEqual(actual: readonly string[], expected: readonly string[], message: string): void {
    const actualSorted = [...actual].sort();
    const expectedSorted = [...expected].sort();
    if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
        throw new Error(
            `${message}\nExpected: ${JSON.stringify(expectedSorted)}\nActual: ${JSON.stringify(actualSorted)}`
        );
    }
}

export function createUpgradeScenarioPaths(label: string): UpgradeScenarioPaths {
    const root = `E2E/upgrade-from-${STABLE_RELEASE_VERSION}/${label}`;
    return {
        original: `${root}/rename-source.md`,
        renamed: `${root}/renamed.md`,
        deleted: `${root}/deleted.md`,
        postUpgrade: `${root}/post-upgrade.md`,
        returnFromVerifier: `${root}/return-from-verifier.md`,
    };
}

function remoteSettings(configuration: UpgradeTransportConfiguration): Record<string, unknown> {
    if (configuration.kind === "couchdb") {
        return {
            remoteType: "",
            couchDB_URI: configuration.config.uri,
            couchDB_USER: configuration.config.username,
            couchDB_PASSWORD: configuration.config.password,
            couchDB_DBNAME: configuration.databaseName,
            isConfigured: true,
        };
    }
    return {
        remoteType: "MINIO",
        endpoint: configuration.config.endpoint,
        accessKey: configuration.config.accessKey,
        secretKey: configuration.config.secretKey,
        bucket: configuration.config.bucket,
        region: configuration.config.region,
        forcePathStyle: configuration.config.forcePathStyle,
        bucketPrefix: configuration.bucketPrefix,
        bucketCustomHeaders: "",
        isConfigured: true,
    };
}

export async function configureStableRelease(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    configuration: UpgradeTransportConfiguration
): Promise<void> {
    const partial = remoteSettings(configuration);
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            `const partial=${JSON.stringify(partial)};`,
            "await core.services.setting.applyExternalSettings(partial,true);",
            "await core.services.control.applySettings();",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
}

export async function prepareStableRemote(cliBinary: string, environment: NodeJS.ProcessEnv): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const settings=core.services.setting.currentSettings();",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "await replicator.tryCreateRemoteDatabase(settings);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );

    const timeoutMs = Number(process.env.E2E_OBSIDIAN_REMOTE_READY_TIMEOUT_MS ?? 15000);
    const intervalMs = Number(process.env.E2E_OBSIDIAN_REMOTE_READY_INTERVAL_MS ?? 250);
    const deadline = Date.now() + timeoutMs;
    let securitySeedReady = false;
    do {
        securitySeedReady = await evalObsidianJson<boolean>(
            cliBinary,
            [
                "(async()=>{",
                "const core=app.plugins.plugins['obsidian-livesync'].core;",
                "const settings=core.services.setting.currentSettings();",
                "const replicator=core.services.replicator.getActiveReplicator();",
                "return JSON.stringify(!!(await replicator.ensurePBKDF2Salt(settings,true,false)));",
                "})()",
            ].join(""),
            environment
        );
        if (securitySeedReady) break;
        if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (Date.now() < deadline);
    if (!securitySeedReady) {
        throw new Error(`Timed out waiting for the stable release Security Seed after ${timeoutMs}ms.`);
    }

    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const settings=core.services.setting.currentSettings();",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "await replicator.markRemoteResolved(settings);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
}

export async function waitForPersistentNodeIdentity(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    timeoutMs = Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000)
): Promise<string> {
    return await evalObsidianJson<string>(
        cliBinary,
        [
            "(async()=>{",
            `const deadline=Date.now()+${JSON.stringify(timeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const database=core.localDatabase.localDatabase;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "let persistent='';let active='';",
            "while(Date.now()<deadline){",
            "const nodeInfo=await database.get('_local/obsydian_livesync_nodeinfo').catch(()=>null);",
            "persistent=typeof nodeInfo?.nodeid==='string'?nodeInfo.nodeid:'';",
            "active=core.services.replicator.getActiveReplicator()?.nodeid??'';",
            "if(persistent!==''&&active===persistent) return JSON.stringify(persistent);",
            "await sleep(100);",
            "}",
            "throw new Error(`Timed out waiting for persistent node identity: persistent=${persistent}, active=${active}`);",
            "})()",
        ].join(""),
        environment
    );
}

export async function readRuntimeUpgradeState(
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<RuntimeUpgradeState> {
    return await evalObsidianJson<RuntimeUpgradeState>(
        cliBinary,
        [
            "(async()=>{",
            "const plugin=app.plugins.plugins['obsidian-livesync'];",
            "const core=plugin.core;",
            "const setting=core.services.setting;",
            "const settings=setting.currentSettings();",
            "const vaultName=core.services.vault.getVaultName();",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "const databaseInfo=await core.localDatabase.localDatabase.info();",
            "const nodeInfo=await core.localDatabase.localDatabase.get('_local/obsydian_livesync_nodeinfo').catch(()=>null);",
            "const migrationState=setting.getSettingsMigrationState?.();",
            "return JSON.stringify({",
            "pluginVersion:app.plugins.manifests['obsidian-livesync']?.version??'unknown',",
            "vaultName,",
            "localDatabaseName:databaseInfo.db_name,",
            "localDatabaseUpdateSequence:databaseInfo.update_seq,",
            "localDatabaseDocumentCount:databaseInfo.doc_count,",
            "nodeId:nodeInfo?.nodeid??replicator?.nodeid??'',",
            "legacyCompatibilityMarker:localStorage.getItem(`obsidian-live-sync-ver${vaultName}`),",
            "compatibilityMarker:setting.getSmallConfig('database-compatibility-version')??'',",
            "compatibilityStorageEntries:Object.fromEntries(Array.from({length:localStorage.length},(_,index)=>localStorage.key(index))",
            ".filter((key)=>key!==null)",
            ".filter(key=>key.startsWith('obsidian-live-sync-ver')||key.endsWith('-database-compatibility-version'))",
            ".map(key=>[key,localStorage.getItem(key)??''])),",
            "migrationState,",
            "settings:{",
            "isConfigured:settings.isConfigured,settingVersion:settings.settingVersion,",
            "versionUpFlash:settings.versionUpFlash,",
            "liveSync:settings.liveSync,syncOnStart:settings.syncOnStart,syncOnSave:settings.syncOnSave,",
            "syncOnEditorSave:settings.syncOnEditorSave,syncOnFileOpen:settings.syncOnFileOpen,",
            "syncAfterMerge:settings.syncAfterMerge,periodicReplication:settings.periodicReplication,",
            "encrypt:settings.encrypt,usePathObfuscation:settings.usePathObfuscation,",
            "syncInternalFiles:settings.syncInternalFiles,customChunkSize:settings.customChunkSize,",
            "usePluginSyncV2:settings.usePluginSyncV2,enableCompression:settings.enableCompression,",
            "useEden:settings.useEden,filenameCaseType:typeof settings.handleFilenameCaseSensitive,",
            "handleFilenameCaseSensitive:settings.handleFilenameCaseSensitive,",
            "doNotUseFixedRevisionForChunks:settings.doNotUseFixedRevisionForChunks,",
            "chunkSplitterVersion:settings.chunkSplitterVersion,E2EEAlgorithm:settings.E2EEAlgorithm,",
            "additionalSuffixOfDatabaseName:settings.additionalSuffixOfDatabaseName??'',",
            "remoteType:settings.remoteType,couchDB_DBNAME:settings.couchDB_DBNAME??'',",
            "endpoint:settings.endpoint??'',bucket:settings.bucket??'',bucketPrefix:settings.bucketPrefix??'',",
            "activeConfigurationId:settings.activeConfigurationId??'',",
            "remoteConfigurationIds:Object.keys(settings.remoteConfigurations??{}),",
            "doctorProcessedVersion:settings.doctorProcessedVersion??'',",
            "}",
            "});",
            "})()",
        ].join(""),
        environment
    );
}

export async function readRuntimeSettingsUpgradeState(
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<RuntimeSettingsUpgradeState> {
    return await evalObsidianJson<RuntimeSettingsUpgradeState>(
        cliBinary,
        [
            "(async()=>{",
            "const plugin=app.plugins.plugins['obsidian-livesync'];",
            "const setting=plugin.core.services.setting;",
            "const settings=setting.currentSettings();",
            "const migrationState=setting.getSettingsMigrationState?.();",
            "return JSON.stringify({",
            "pluginVersion:app.plugins.manifests['obsidian-livesync']?.version??'unknown',",
            "compatibilityMarker:setting.getSmallConfig?.('database-compatibility-version')??'',",
            "migrationState,",
            "settings:{",
            "isConfigured:settings.isConfigured,settingVersion:settings.settingVersion,",
            "versionUpFlash:settings.versionUpFlash,",
            "liveSync:settings.liveSync,syncOnStart:settings.syncOnStart,syncOnSave:settings.syncOnSave,",
            "syncOnEditorSave:settings.syncOnEditorSave,syncOnFileOpen:settings.syncOnFileOpen,",
            "syncAfterMerge:settings.syncAfterMerge,periodicReplication:settings.periodicReplication,",
            "encrypt:settings.encrypt,usePathObfuscation:settings.usePathObfuscation,",
            "syncInternalFiles:settings.syncInternalFiles,customChunkSize:settings.customChunkSize,",
            "usePluginSyncV2:settings.usePluginSyncV2,enableCompression:settings.enableCompression,",
            "useEden:settings.useEden,filenameCaseType:typeof settings.handleFilenameCaseSensitive,",
            "handleFilenameCaseSensitive:settings.handleFilenameCaseSensitive,",
            "doNotUseFixedRevisionForChunks:settings.doNotUseFixedRevisionForChunks,",
            "chunkSplitterVersion:settings.chunkSplitterVersion,E2EEAlgorithm:settings.E2EEAlgorithm,",
            "additionalSuffixOfDatabaseName:settings.additionalSuffixOfDatabaseName??'',",
            "remoteType:settings.remoteType,couchDB_DBNAME:settings.couchDB_DBNAME??'',",
            "endpoint:settings.endpoint??'',bucket:settings.bucket??'',bucketPrefix:settings.bucketPrefix??'',",
            "activeConfigurationId:settings.activeConfigurationId??'',",
            "remoteConfigurationIds:Object.keys(settings.remoteConfigurations??{}),",
            "doctorProcessedVersion:settings.doctorProcessedVersion??'',",
            "}",
            "});",
            "})()",
        ].join(""),
        environment
    );
}

export function assertStableReleaseDefaults(state: RuntimeSettingsUpgradeState, configured: boolean): void {
    assertEqual(
        state.pluginVersion,
        STABLE_RELEASE_VERSION,
        "The source session did not load the pinned stable release."
    );
    assertEqual(state.settings.isConfigured, configured, "The stable release configuration lifecycle was unexpected.");
    assertEqual(state.settings.settingVersion, 10, "The stable release settings schema was not version 10.");
    assertEqual(state.settings.liveSync, false, "The stable release LiveSync default changed.");
    assertEqual(state.settings.syncOnStart, false, "The stable release sync-on-start default changed.");
    assertEqual(state.settings.syncOnSave, false, "The stable release sync-on-save default changed.");
    assertEqual(state.settings.syncOnEditorSave, false, "The stable release editor-save default changed.");
    assertEqual(state.settings.syncOnFileOpen, false, "The stable release file-open default changed.");
    assertEqual(state.settings.syncAfterMerge, false, "The stable release post-merge default changed.");
    assertEqual(state.settings.periodicReplication, false, "The stable release periodic default changed.");
    assertEqual(state.settings.encrypt, false, "The stable release encryption default changed.");
    assertEqual(state.settings.usePathObfuscation, false, "The stable release path-obfuscation default changed.");
    assertEqual(state.settings.syncInternalFiles, false, "The stable release Hidden File default changed.");
    assertEqual(state.settings.customChunkSize, 0, "The stable release custom chunk default changed.");
    assertEqual(state.settings.usePluginSyncV2, false, "The stable release Customisation Sync V2 default changed.");
    assertEqual(state.settings.enableCompression, false, "The stable release compression default changed.");
    assertEqual(state.settings.useEden, false, "The stable release Eden default changed.");
    assertEqual(
        state.settings.filenameCaseType,
        "undefined",
        "The stable release filename-case decision was preselected."
    );
    assertEqual(
        state.settings.doNotUseFixedRevisionForChunks,
        true,
        "The stable release fixed-revision compatibility value changed."
    );
    assertEqual(state.settings.chunkSplitterVersion, "v3-rabin-karp", "The stable release chunk splitter changed.");
    assertEqual(state.settings.E2EEAlgorithm, "v2", "The stable release E2EE algorithm changed.");
    assertEqual(
        state.settings.remoteConfigurationIds.length,
        configured ? 1 : 0,
        "The stable release remote-profile count was unexpected."
    );
}

export function assertUnconfiguredUpgradeReady(
    stable: RuntimeSettingsUpgradeState,
    upgraded: RuntimeSettingsUpgradeState,
    targetVersion: string
): void {
    assertStableReleaseDefaults(stable, false);
    assertEqual(upgraded.pluginVersion, targetVersion, "The unconfigured Vault did not load the target artefact.");
    assertEqual(upgraded.settings.isConfigured, false, "The upgrade changed an unconfigured Vault to configured.");
    assertEqual(
        upgraded.settings.usePluginSyncV2,
        stable.settings.usePluginSyncV2,
        "The upgrade applied a new-Vault recommendation to a non-empty legacy store."
    );
    assertEqual(
        upgraded.settings.handleFilenameCaseSensitive,
        false,
        "The unconfigured legacy Vault did not retain case-insensitive handling."
    );
    assertEqual(upgraded.settings.versionUpFlash, "", "The unconfigured Vault was paused for compatibility review.");
    assertEqual(
        upgraded.compatibilityMarker,
        "",
        "The unconfigured Vault acknowledged database compatibility before activation."
    );
    if (!upgraded.migrationState) throw new Error("The unconfigured settings migration state was not available.");
    assertEqual(upgraded.migrationState.isNewVault, false, "The non-empty legacy store was treated as a new store.");
    // The real-session helper deliberately reloads an already enabled plug-in.
    // The first target load performs and persists the migration; the observed
    // post-reload state can therefore report changed=false. The workflow reads
    // data.json after stopping the session to prove the persisted values.
    assertEqual(
        upgraded.migrationState.requiresSyncReview,
        false,
        "The unconfigured legacy settings unexpectedly required compatibility review."
    );
    assertEqual(upgraded.migrationState.reviewReasons.length, 0, "The unconfigured migration emitted a review reason.");
}

export function assertUnconfiguredUpgradeRestarted(state: RuntimeSettingsUpgradeState, targetVersion: string): void {
    assertEqual(state.pluginVersion, targetVersion, "The unconfigured restart did not load the target artefact.");
    assertEqual(state.settings.isConfigured, false, "The unconfigured state was not persisted across restart.");
    assertEqual(state.settings.usePluginSyncV2, false, "Restart applied a new-Vault recommendation.");
    assertEqual(state.settings.handleFilenameCaseSensitive, false, "Restart lost the case-insensitive policy.");
    assertEqual(
        state.compatibilityMarker,
        "",
        "Restart acknowledged database compatibility while the Vault remained unconfigured."
    );
    if (!state.migrationState) throw new Error("The restarted settings migration state was not available.");
    assertEqual(state.migrationState.changed, false, "The settings migration was not idempotent after restart.");
    assertEqual(state.migrationState.requiresSyncReview, false, "Restart introduced a compatibility review.");
}

export function assertStableRemoteSelection(
    state: RuntimeUpgradeState,
    configuration: UpgradeTransportConfiguration
): void {
    assertEqual(state.settings.isConfigured, true, "The stable release was not marked as configured.");
    if (!state.settings.activeConfigurationId) throw new Error("The stable release did not select its remote profile.");
    if (!state.settings.remoteConfigurationIds.includes(state.settings.activeConfigurationId)) {
        throw new Error("The stable release active remote profile was not persisted.");
    }
    if (configuration.kind === "couchdb") {
        assertEqual(state.settings.remoteType, "", "The stable release did not select CouchDB.");
        assertEqual(
            state.settings.couchDB_DBNAME,
            configuration.databaseName,
            "The stable release CouchDB database changed."
        );
    } else {
        assertEqual(state.settings.remoteType, "MINIO", "The stable release did not select Object Storage.");
        assertEqual(state.settings.endpoint, configuration.config.endpoint, "The Object Storage endpoint changed.");
        assertEqual(state.settings.bucket, configuration.config.bucket, "The Object Storage bucket changed.");
        assertEqual(state.settings.bucketPrefix, configuration.bucketPrefix, "The Object Storage prefix changed.");
    }
}

export function assertUpgradeCompatibilityReady(
    stable: RuntimeUpgradeState,
    upgraded: RuntimeUpgradeState,
    targetVersion: string,
    configuration: UpgradeTransportConfiguration
): void {
    assertEqual(upgraded.pluginVersion, targetVersion, "The upgraded session did not load the target artefact.");
    assertEqual(
        upgraded.localDatabaseName,
        stable.localDatabaseName,
        "The upgrade opened a different local synchronisation database."
    );
    if (upgraded.localDatabaseDocumentCount < stable.localDatabaseDocumentCount) {
        throw new Error("The upgrade lost local synchronisation documents before its first sync.");
    }
    if (stable.nodeId.length === 0) {
        throw new Error("The stable release did not persist a device node identity.");
    }
    assertEqual(upgraded.nodeId, stable.nodeId, "The upgrade changed the persistent device node identity.");
    assertEqual(
        upgraded.settings.additionalSuffixOfDatabaseName,
        stable.settings.additionalSuffixOfDatabaseName,
        "The upgrade changed the local database suffix."
    );
    assertStringArraysEqual(
        upgraded.settings.remoteConfigurationIds,
        stable.settings.remoteConfigurationIds,
        "The upgrade changed the stored remote-profile identities."
    );
    assertEqual(
        upgraded.settings.activeConfigurationId,
        stable.settings.activeConfigurationId,
        "The upgrade changed the active remote profile."
    );
    assertStableRemoteSelection(upgraded, configuration);
    for (const key of [
        "liveSync",
        "syncOnStart",
        "syncOnSave",
        "syncOnEditorSave",
        "syncOnFileOpen",
        "syncAfterMerge",
        "periodicReplication",
        "customChunkSize",
        "usePluginSyncV2",
        "enableCompression",
        "useEden",
        "doNotUseFixedRevisionForChunks",
    ] as const) {
        assertEqual(upgraded.settings[key], stable.settings[key], `The upgrade rewrote the stored ${key} preference.`);
    }
    if (!upgraded.migrationState) throw new Error("The 1.0 settings migration state was not available.");
    // The session helper reloads the enabled target after its first load has
    // persisted the normalised case value. Runtime settings below and the
    // later restart prove that persisted result without depending on whether
    // this observation came from the first or second load.
    assertEqual(
        upgraded.migrationState.requiresSyncReview,
        false,
        "The legacy case-insensitive setting unexpectedly required compatibility review."
    );
    assertEqual(upgraded.migrationState.reviewReasons.length, 0, "The settings migration emitted a spurious review.");
    assertEqual(stable.legacyCompatibilityMarker, "12", "The stable release did not persist its legacy marker.");
    assertEqual(upgraded.legacyCompatibilityMarker, null, "The upgrade did not retire the legacy marker.");
    assertEqual(
        upgraded.compatibilityMarker,
        "12",
        [
            "The upgrade did not migrate the legacy compatibility marker.",
            `Vault: ${upgraded.vaultName}`,
            `Database suffix: ${upgraded.settings.additionalSuffixOfDatabaseName}`,
            `Device-local entries: ${JSON.stringify(upgraded.compatibilityStorageEntries)}`,
        ].join("\n")
    );
    assertEqual(upgraded.settings.versionUpFlash, "", "Synchronisation was unexpectedly paused after migration.");
    assertEqual(
        upgraded.settings.handleFilenameCaseSensitive,
        false,
        "The missing legacy filename-case value did not preserve case-insensitive handling."
    );
}

export function assertUpgradeRemainsReady(state: RuntimeUpgradeState, targetVersion: string): void {
    assertEqual(state.pluginVersion, targetVersion, "The upgraded session changed target artefact.");
    assertEqual(state.settings.versionUpFlash, "", "A compatibility pause reappeared.");
    assertEqual(state.compatibilityMarker, "12", "The compatibility acknowledgement was not persisted.");
    assertEqual(
        state.settings.handleFilenameCaseSensitive,
        false,
        "The migrated legacy case-insensitive policy was not persisted."
    );
}

export async function dismissConfigDoctorIfShown(port: number): Promise<boolean> {
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_UI_TIMEOUT_MS ?? 10000);
    return await withObsidianPage(port, async (page) => {
        const doctor = page.locator(".modal-container").filter({
            has: page.locator(".modal-title").filter({ hasText: "Self-hosted LiveSync Config Doctor" }),
        });
        const visible = await doctor
            .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 5000) })
            .then(() => true)
            .catch(() => false);
        if (!visible) return false;
        await doctor.getByRole("button", { name: /No, and do not ask again/u }).click();
        await doctor.waitFor({ state: "hidden", timeout: timeoutMs });
        return true;
    });
}

async function writeNote(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    path: string,
    content: string
): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const content=${JSON.stringify(content)};`,
            "const folder=path.split('/').slice(0,-1).join('/');",
            "if(folder&&!(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder);",
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(existing) await app.vault.modify(existing,content); else await app.vault.create(path,content);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
}

async function renameNote(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    fromPath: string,
    toPath: string
): Promise<void> {
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
        environment
    );
}

async function deleteNote(cliBinary: string, environment: NodeJS.ProcessEnv, path: string): Promise<void> {
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            "const existing=app.vault.getAbstractFileByPath(path);",
            "if(!existing) throw new Error(`Could not find note to delete: ${path}`);",
            "await app.vault.delete(existing);",
            "return JSON.stringify({ok:true});",
            "})()",
        ].join(""),
        environment
    );
}

async function waitForChangedRevision(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    path: string,
    previousRevision: string
): Promise<void> {
    const timeoutMs = Number(process.env.E2E_OBSIDIAN_LOCAL_DB_TIMEOUT_MS ?? 15000);
    await evalObsidianJson<unknown>(
        cliBinary,
        [
            "(async()=>{",
            `const path=${JSON.stringify(path)};`,
            `const previousRevision=${JSON.stringify(previousRevision)};`,
            `const deadline=Date.now()+${JSON.stringify(timeoutMs)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));",
            "while(Date.now()<deadline){",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const entry=await core.localDatabase.getDBEntry(path,undefined,false,true).catch(()=>false);",
            "if(entry&&entry._rev&&entry._rev!==previousRevision) return JSON.stringify({rev:entry._rev});",
            "await sleep(250);",
            "}",
            "throw new Error(`Timed out waiting for a changed local revision: ${path}`);",
            "})()",
        ].join(""),
        environment
    );
}

export async function runStableFileHistory(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    paths: UpgradeScenarioPaths,
    synchronise: () => Promise<void>
): Promise<void> {
    await writeNote(cliBinary, environment, paths.original, firstContent);
    await writeNote(cliBinary, environment, paths.deleted, deletedContent);
    const originalEntry = await waitForLocalDatabaseEntry(cliBinary, environment, paths.original);
    await waitForLocalDatabaseEntry(cliBinary, environment, paths.deleted);
    await synchronise();

    await writeNote(cliBinary, environment, paths.original, editedContent);
    await waitForChangedRevision(cliBinary, environment, paths.original, originalEntry.rev);
    await synchronise();

    await renameNote(cliBinary, environment, paths.original, paths.renamed);
    await waitForLocalDatabaseEntry(cliBinary, environment, paths.renamed);
    await synchronise();

    await deleteNote(cliBinary, environment, paths.deleted);
    await synchronise();
}

export async function createPostUpgradeDelta(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    paths: UpgradeScenarioPaths
): Promise<void> {
    await writeNote(cliBinary, environment, paths.postUpgrade, postUpgradeContent);
    await waitForLocalDatabaseEntry(cliBinary, environment, paths.postUpgrade);
}

export async function createVerifierReturnDelta(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    paths: UpgradeScenarioPaths
): Promise<void> {
    await writeNote(cliBinary, environment, paths.returnFromVerifier, returnContent);
    await waitForLocalDatabaseEntry(cliBinary, environment, paths.returnFromVerifier);
}

async function pathExists(vault: TemporaryVault, path: string): Promise<boolean> {
    try {
        await readFile(join(vault.path, path));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function waitForPathContent(vault: TemporaryVault, path: string, content: string): Promise<void> {
    const deadline = Date.now() + Number(process.env.E2E_OBSIDIAN_FILE_TIMEOUT_MS ?? 30000);
    let lastContent = "";
    while (Date.now() < deadline) {
        try {
            lastContent = await readFile(join(vault.path, path), "utf8");
            if (lastContent === content) return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Timed out waiting for ${path}. Last content:\n${lastContent}`);
}

export async function verifyPreUpgradeHistory(vault: TemporaryVault, paths: UpgradeScenarioPaths): Promise<void> {
    await waitForPathContent(vault, paths.renamed, editedContent);
    if (await pathExists(vault, paths.original)) throw new Error(`Renamed source was resurrected: ${paths.original}`);
    if (await pathExists(vault, paths.deleted)) throw new Error(`Deleted note was resurrected: ${paths.deleted}`);
}

export async function verifyPostUpgradeHistory(vault: TemporaryVault, paths: UpgradeScenarioPaths): Promise<void> {
    await verifyPreUpgradeHistory(vault, paths);
    await waitForPathContent(vault, paths.postUpgrade, postUpgradeContent);
}

export async function verifyReturnDelta(vault: TemporaryVault, paths: UpgradeScenarioPaths): Promise<void> {
    await waitForPathContent(vault, paths.returnFromVerifier, returnContent);
}

export async function ensureScenarioDirectory(vault: TemporaryVault, paths: UpgradeScenarioPaths): Promise<void> {
    await mkdir(dirname(join(vault.path, paths.original)), { recursive: true });
}

export async function runCouchDbReplicationObserved(
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<CouchDbReplicationObservation> {
    return await evalObsidianJson<CouchDbReplicationObservation>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "const beforeSent=Number(replicator.docSent??0);",
            "const beforeArrived=Number(replicator.docArrived??0);",
            "const result=await core.services.replication.replicate(true);",
            "return JSON.stringify({",
            "succeeded:!!result,",
            "sentDocuments:Number(replicator.docSent??0)-beforeSent,",
            "arrivedDocuments:Number(replicator.docArrived??0)-beforeArrived,",
            "});",
            "})()",
        ].join(""),
        environment
    );
}

export async function runJournalReplicationObserved(
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<JournalReplicationObservation> {
    return await evalObsidianJson<JournalReplicationObservation>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "const client=replicator.client;",
            "const storage=client.storage;",
            "const originalDownload=storage.download.bind(storage);",
            "const originalUpload=storage.upload.bind(storage);",
            "const downloadedJournalKeys=[];const uploadedJournalKeys=[];",
            "const isJournal=(key)=>!String(key).split('/').pop().startsWith('_');",
            "storage.download=async(key,...args)=>{if(isJournal(key))downloadedJournalKeys.push(String(key));return await originalDownload(key,...args);};",
            "storage.upload=async(key,...args)=>{if(isJournal(key))uploadedJournalKeys.push(String(key));return await originalUpload(key,...args);};",
            "let succeeded=false;",
            "try{",
            "await core.services.fileProcessing.commitPendingFileEvents();",
            "succeeded=!!(await core.services.replication.replicate(true));",
            "}finally{storage.download=originalDownload;storage.upload=originalUpload;}",
            "return JSON.stringify({succeeded,downloadedJournalKeys,uploadedJournalKeys});",
            "})()",
        ].join(""),
        environment
    );
}

export async function readJournalCheckpoint(
    cliBinary: string,
    environment: NodeJS.ProcessEnv
): Promise<JournalCheckpointSnapshot> {
    return await evalObsidianJson<JournalCheckpointSnapshot>(
        cliBinary,
        [
            "(async()=>{",
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const replicator=core.services.replicator.getActiveReplicator();",
            "const client=replicator.client;",
            "const checkpoint=await client.getCheckpointInfo();",
            "const sorted=(value)=>[...(value??[])].sort();",
            "return JSON.stringify({",
            "remoteKey:client.getRemoteKey(),lastLocalSeq:checkpoint.lastLocalSeq,journalEpoch:checkpoint.journalEpoch,",
            "knownIDs:sorted(checkpoint.knownIDs),sentIDs:sorted(checkpoint.sentIDs),",
            "receivedFiles:sorted(checkpoint.receivedFiles),sentFiles:sorted(checkpoint.sentFiles),",
            "});",
            "})()",
        ].join(""),
        environment
    );
}

export async function readLocalCouchDbCheckpoints(
    cliBinary: string,
    environment: NodeJS.ProcessEnv,
    checkpointIds: readonly string[]
): Promise<CouchDbCheckpointSnapshot[]> {
    return await evalObsidianJson<CouchDbCheckpointSnapshot[]>(
        cliBinary,
        [
            "(async()=>{",
            `const ids=${JSON.stringify(checkpointIds)};`,
            "const core=app.plugins.plugins['obsidian-livesync'].core;",
            "const database=core.localDatabase.localDatabase;",
            "const checkpoints=[];",
            "for(const id of ids){",
            "const doc=await database.get(id).catch(()=>false);",
            "if(doc&&Object.prototype.hasOwnProperty.call(doc,'last_seq')) checkpoints.push({id,lastSequence:doc.last_seq});",
            "}",
            "return JSON.stringify(checkpoints);",
            "})()",
        ].join(""),
        environment
    );
}
