// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ChunkAlgorithms, E2EEAlgorithms, HashAlgorithms, MODE_AUTOMATIC, MODE_PAUSED, MODE_SELECTIVE, MODE_SHINY, RemoteTypes } from "./setting.const";
import type { I18N_LANGS } from "@lib/common/rosetta";
import type { CustomRegExpSourceList } from "./shared.type.util";
import type { JWTAlgorithm } from "./auth.type";
/**
 * Represents the connection details required to connect to a CouchDB instance.
 */
export interface CouchDBConnection {
    /**
     * The URI of the CouchDB instance.
     */
    couchDB_URI: string;
    /**
     * The username to use when connecting to the CouchDB instance.
     */
    couchDB_USER: string;
    /**
     * The password to use when connecting to the CouchDB instance.
     */
    couchDB_PASSWORD: string;
    /**
     * The name of the database to use.
     */
    couchDB_DBNAME: string;
    /**
     * e.g. `x-some-header: some-value\n x-some-header2: some-value2`
     */
    couchDB_CustomHeaders: string;
    useJWT: boolean;
    jwtAlgorithm: JWTAlgorithm;
    jwtKey: string;
    jwtKid: string;
    jwtSub: string;
    jwtExpDuration: number;
    /**
     * Use Request API to avoid `inevitable` CORS problem.
     * Seems stable, so promoted to the normal setting.
     */
    useRequestAPI: boolean;
}
/**
 * Interface representing the settings for periodic replication.
 */
interface PeriodicReplicationSettings {
    /**
     * Indicates whether periodic replication is enabled.
     */
    periodicReplication: boolean;
    /**
     * The interval, in milliseconds, at which periodic replication occurs.
     */
    periodicReplicationInterval: number;
}
export type ConfigPassphraseStore = "" | "LOCALSTORAGE" | "ASK_AT_LAUNCH";
/**
 * Represents the user settings that are encrypted.
 */
interface EncryptedUserSettings {
    /**
     * The store for the configuration passphrase.
     */
    configPassphraseStore: ConfigPassphraseStore;
    /**
     * The encrypted passphrase used for E2EE.
     */
    encryptedPassphrase: string;
    /**
     * The encrypted connection details for CouchDB.
     */
    encryptedCouchDBConnection: string;
}
/**
 * Interface representing the settings for different sync invocation methods.
 */
interface SyncMethodSettings {
    /**
     * Synchronise in Live. This is an exclusive setting against other sync methods.
     */
    liveSync: boolean;
    /**
     * automatically run sync on save.
     * File modification will trigger the sync, even if the file is not changed on the editor.
     */
    syncOnSave: boolean;
    /**
     * automatically run sync on starting the plug-in.
     */
    syncOnStart: boolean;
    /**
     * automatically run sync on opening a file.
     */
    syncOnFileOpen: boolean;
    /**
     * automatically run sync on editor save.
     * Different from syncOnSave, this is only reacts to the editor save event.
     */
    syncOnEditorSave: boolean;
    /**
     * Desktop only, opt-in. Keep replication running while the window is hidden or minimised,
     * instead of suspending it until the window becomes visible again. The trigger is
     * document.hidden, not window focus. Applies to the background-capable sync modes (LiveSync
     * and Periodic). Ignored on mobile. Default false.
     */
    keepReplicationActiveInBackground: boolean;
    /**
     * The minimum delay between synchronisation operations (in milliseconds).
     * If the operation is triggered before this delay, the operation will be delayed until the delay is over, and executed as a single operation.
     */
    syncMinimumInterval: number;
}
/**
 * Interface representing the settings for file handling.
 */
interface FileHandlingSettings {
    /**
     * Use trash instead of actually delete.
     */
    trashInsteadDelete: boolean;
    /**
     * Do not delete the folder even if it has got empty.
     */
    doNotDeleteFolder: boolean;
    /**
     * Thinning out the changes and make a single change for the same file.
     */
    batchSave: boolean;
    batchSaveMinimumDelay: number;
    batchSaveMaximumDelay: number;
    /**
     * Maximum size of the file to be synchronized (in MB).
     */
    syncMaxSizeInMB: number;
    /**
     * Use ignore files.
     */
    useIgnoreFiles: boolean;
    /**
     * Ignore files pattern, i,e, `.gitignore, .obsidianignore` (This should be separated by comma)
     */
    ignoreFiles: string;
    /**
     * Do not prevent write if the size is mismatched.
     */
    processSizeMismatchedFiles: boolean;
}
/**
 * Interface representing the settings for Hidden File Sync.
 */
interface InternalFileSettings {
    /**
     * Synchronise internal files.
     */
    syncInternalFiles: boolean;
    /**
     * Scan internal files before replication.
     */
    syncInternalFilesBeforeReplication: boolean;
    /**
     * Interval for scanning internal files (in seconds).
     */
    syncInternalFilesInterval: number;
    /**
     * Ignore patterns for internal files.
     * (Comma separated list of regular expressions)
     */
    syncInternalFilesIgnorePatterns: CustomRegExpSourceList<",">;
    /**
     * Limit patterns for internal files.
     */
    syncInternalFilesTargetPatterns: CustomRegExpSourceList<",">;
    /**
     * Enable watch internal file changes (This option uses the unexposed API)
     */
    watchInternalFileChanges: boolean;
    /**
     * Suppress notification of hidden files change.
     */
    suppressNotifyHiddenFilesChange: boolean;
    /**
     * Overwrite instead of merging patterns for internal files.
     */
    syncInternalFileOverwritePatterns: CustomRegExpSourceList<",">;
}
export type SYNC_MODE = typeof MODE_SELECTIVE | typeof MODE_AUTOMATIC | typeof MODE_PAUSED | typeof MODE_SHINY;
export interface PluginSyncSettingEntry {
    key: string;
    mode: SYNC_MODE;
    files: string[];
}
/**
 * Interface representing the settings for plugin synchronisation.
 */
interface PluginSyncSettings {
    /**
     * Indicates whether plugin synchronisation is enabled.
     */
    usePluginSync: boolean;
    /**
     * Indicates whether plugin settings synchronisation is enabled.
     */
    usePluginSettings: boolean;
    /**
     * Indicates whether to show the device's own plugins.
     */
    showOwnPlugins: boolean;
    /**
     * Indicates whether to automatically scan plugins.
     */
    autoSweepPlugins: boolean;
    /**
     * Indicates whether to periodically scan plugins automatically.
     */
    autoSweepPluginsPeriodic: boolean;
    /**
     * Indicates whether to notify when a plugin or setting is updated.
     */
    notifyPluginOrSettingUpdated: boolean;
    /**
     * The name of the device and vault.
     * This is used to identify the device and vault among synchronised devices and vaults.
     * Hence, this should be unique among devices and vaults.
     */
    deviceAndVaultName: string;
    /**
     * Indicates whether the v2 of plugin synchronisation is enabled.
     */
    usePluginSyncV2: boolean;
    /**
     * Indicates whether additional plugin synchronisation settings are enabled.
     * This setting is hidden from the UI.
     */
    usePluginEtc: boolean;
    /**
     * Extended settings for plugin synchronisation.
     */
    pluginSyncExtendedSetting: Record<PluginSyncSettingEntry["key"], PluginSyncSettingEntry>;
}
/**
 * Interface representing the user interface settings.
 */
interface UISettings {
    /**
     * Indicates whether verbose logging has been enabled.
     */
    showVerboseLog: boolean;
    /**
     * Indicates whether less information should be shown in the log.
     */
    lessInformationInLog: boolean;
    /**
     * Indicates whether longer status line should be shown inside the editor.
     */
    showLongerLogInsideEditor: boolean;
    /**
     * Indicates whether the status line should be shown on the editor.
     */
    showStatusOnEditor: boolean;
    /**
     * Indicates whether the status line should be shown on the status bar.
     */
    showStatusOnStatusbar: boolean;
    /**
     * Indicates whether only icons instead of status line should be shown on the editor.
     */
    showOnlyIconsOnEditor: boolean;
    /**
     * Hide File warning notice bar.
     */
    hideFileWarningNotice: boolean;
    /**
     * How to display connection error warnings.
     * "banner" shows the full banner, "icon" shows only an icon, "hidden" suppresses entirely.
     */
    networkWarningStyle: "" | "icon" | "hidden";
    /**
     * The language to be used for display.
     */
    displayLanguage: I18N_LANGS;
}
/**
 * Interface representing the settings for mode of exposing advanced things.
 */
interface ModeSettings {
    /**
     * Indicates whether the advanced mode is enabled.
     */
    useAdvancedMode: boolean;
    /**
     * Indicates whether the power user mode is enabled.
     */
    usePowerUserMode: boolean;
    /**
     * Indicates whether the edge case mode is enabled.
     */
    useEdgeCaseMode: boolean;
}
/**
 * Interface representing the settings for debug mode.
 */
interface DebugModeSettings {
    /**
     * Indicates whether the debug tools of Self-hosted LiveSync are enabled.
     */
    enableDebugTools: boolean;
    /**
     * Indicates whether to write log to the file.
     */
    writeLogToTheFile: boolean;
}
/**
 * Interface representing additional tweak settings.
 */
interface ExtraTweakSettings {
    /**
     * The threshold value for notifying about the size of remote storage.
     * When the size of the remote storage exceeds this threshold, a notification will be triggered.
     */
    notifyThresholdOfRemoteStorageSize: number;
}
/**
 * Interface representing the settings for beta tweaks.
 */
interface BetaTweakSettings {
    /**
     * Indicates whether to disable the WebWorker for generating chunks.
     */
    disableWorkerForGeneratingChunks: boolean;
    /**
     * Indicates whether to process small files in the UI thread.
     */
    processSmallFilesInUIThread: boolean;
}
/**
 * Interface representing the settings for synchronising settings via file.
 */
interface SettingSyncSettings {
    /**
     * The file path where the settings is stored.
     */
    settingSyncFile: string;
    /**
     * Indicates whether to write credentials for settings synchronising.
     */
    writeCredentialsForSettingSync: boolean;
    /**
     * Indicates whether to notify all settings synchronising files events.
     */
    notifyAllSettingSyncFile: boolean;
}
/**
 * Represents settings that are considered obsolete and are not configurable from the UI.
 */
interface ObsoleteSettings {
    /**
     * Saving delay (in milliseconds).
     */
    savingDelay: number;
    /**
     * Garbage collection delay (in milliseconds). Now, no longer GC is implemented.
     */
    gcDelay: number;
    /**
     * Skip older files on sync. No effect now.
     */
    skipOlderFilesOnSync: boolean;
    /**
     * Use the IndexedDB adapter. Now always true. Should be.
     */
    useIndexedDBAdapter: boolean;
}
/**
 * Interface representing some data stored in the settings for the plugin.
 */
interface DataOnSettings {
    /**
     * VersionUp flash message which is shown when some incompatible changes are made during the update.
     */
    versionUpFlash: string;
    /**
     * Setting file version, to migrate the settings.
     */
    settingVersion: number;
    /**
     * Indicates whether the setting of the plug-in is configured once.
     */
    isConfigured?: boolean;
    /**
     * The user-last-read version number.
     */
    lastReadUpdates: number;
    /**
     * The last checked version by the doctor.
     */
    doctorProcessedVersion: string;
}
/**
 * Interface representing the settings for a safety valve mechanism.
 */
interface SafetyValveSettings {
    /**
     * Indicates whether file watching should be suspended.
     */
    suspendFileWatching: boolean;
    /**
     * Indicates whether parsing and reflecting of replication results should be suspended.
     */
    suspendParseReplicationResult: boolean;
    /**
     * Indicates whether suspension should be avoided during fetching operations.
     */
    doNotSuspendOnFetching: boolean;
    /**
     * Maximum file modification time applied to reflected file events
     */
    maxMTimeForReflectEvents: number;
}
/**
 * Represents the settings required to synchronise with a bucket.
 */
export interface BucketSyncSetting {
    /**
     * The access key to use when connecting to the bucket.
     */
    accessKey: string;
    /**
     * The secret to use when connecting to the bucket.
     */
    secretKey: string;
    /**
     * The name of bucket to use.
     */
    bucket: string;
    /**
     * The region of the bucket.
     */
    region: string;
    /**
     * The endpoint of the bucket.
     */
    endpoint: string;
    /**
     * Indicates whether to use a custom request handler.
     * (This is for CORS issue).
     */
    useCustomRequestHandler: boolean;
    bucketCustomHeaders: string;
    /**
     * The prefix to use for the bucket (e.g., "my-bucket/", means mostly like a folder).
     */
    bucketPrefix: string;
    /**
     * Indicates whether to force path style access.
     */
    forcePathStyle: boolean;
}
export interface LocalDBSettings {
    /**
     * Indicates whether to use the IndexedDB adapter for the local database.
     * @deprecated
     */
    useIndexedDBAdapter: boolean;
}
export type RemoteType = (typeof RemoteTypes)[keyof typeof RemoteTypes];
export declare enum AutoAccepting {
    NONE = 0,
    ALL = 1
}
export interface P2PConnectionInfo {
    /**
     * Indicates whether P2P connection is enabled.
     */
    P2P_Enabled: boolean;
    /**
     * Nostr relay server URL. (Comma separated list)
     * This is only for the channelling server to establish for the P2P connection.
     * No data is transferred through this server.
     */
    P2P_relays: string;
    /**
     * The room ID for `your devices`. This should be unique among the users.
     * (Or, lines will be got mixed up).
     */
    P2P_roomID: string;
    /**
     * The passphrase for your devices.
     * It can be empty, but it will help you if you have a duplicate Room ID.
     */
    P2P_passphrase: string;
    /**
     * The Application ID for the P2P connection.
     * This is used to identify the application using the P2P network.
     * In Self-hosted LiveSync, fixed to "self-hosted-livesync".
     */
    P2P_AppID: string;
    /**
     * Indicates whether to auto-start the P2P connection on launch.
     */
    P2P_AutoStart: boolean;
    /**
     * Indicates whether to automatically broadcast changes to connected peers.
     */
    P2P_AutoBroadcast: boolean;
    /**
     * The name of the device peer (This only for editing-setting purpose, not saved in the actual setting file, due to avoid setting-sync issues).
     */
    P2P_DevicePeerName?: string;
    /**
     * The TURN server URLs for the P2P connection. (Comma separated list)
     */
    P2P_turnServers: string;
    /**
     * The TURN username for the P2P connection.
     */
    P2P_turnUsername: string;
    /**
     * The TURN credential (password, secret, etc...) for the P2P connection.
     */
    P2P_turnCredential: string;
    /**
     * Use Diagnostic Wrapper for RTCPeerConnection to collect statistics.
     */
    P2P_useDiagRTC?: boolean;
}
export interface P2PSyncSetting extends P2PConnectionInfo {
    P2P_AutoAccepting: AutoAccepting;
    P2P_AutoSyncPeers: string;
    P2P_AutoWatchPeers: string;
    P2P_SyncOnReplication: string;
    P2P_RebuildFrom: string;
    P2P_AutoAcceptingPeers: string;
    P2P_AutoDenyingPeers: string;
    P2P_IsHeadless?: boolean;
}
/**
 * Interface representing the settings for a remote type.
 */
export interface RemoteTypeSettings {
    /**
     * The type of the remote.
     */
    remoteType: RemoteType;
}
export type E2EEAlgorithm = (typeof E2EEAlgorithms)[keyof typeof E2EEAlgorithms] | "";
/**
 * Represents the settings used for End-to-End encryption.
 */
export interface EncryptionSettings {
    /**
     * Indicates whether E2EE is enabled.
     */
    encrypt: boolean;
    /**
     * The passphrase used for E2EE.
     */
    passphrase: string;
    /**
     * Indicates whether path obfuscation is used.
     * If not, the path will be stored as it is, as the document ID.
     */
    usePathObfuscation: boolean;
    /**
     * The algorithm used for hashing the passphrase.
     * This is used for E2EE.
     */
    E2EEAlgorithm: E2EEAlgorithm;
}
export type HashAlgorithm = (typeof HashAlgorithms)[keyof typeof HashAlgorithms];
export type ChunkSplitterVersion = (typeof ChunkAlgorithms)[keyof typeof ChunkAlgorithms] | "";
/**
 * Interface representing the settings for chunk processing.
 */
interface ChunkSettings {
    /**
     * The algorithm used for hashing chunks.
     */
    hashAlg: HashAlgorithm;
    /**
     * The minimum size of a chunk in chars.
     */
    minimumChunkSize: number;
    /**
     * The custom size of a chunk.
     * Note: This value used as a coefficient for the normal chunk size.
     */
    customChunkSize: number;
    /**
     * The threshold for considering a line as long.
     * (Not respected in v0.24.x).
     */
    longLineThreshold: number;
    /**
     * Flag indicating whether to use a segmenter for chunking.
     * @deprecated use chunkSplitterVersion instead.
     */
    useSegmenter: boolean;
    /**
     * Flag indicating whether to enable version 2 of the chunk splitter.
     * @deprecated use chunkSplitterVersion instead.
     */
    enableChunkSplitterV2: boolean;
    /**
     * Flag indicating whether to avoid using a fixed revision for chunks.
     */
    doNotUseFixedRevisionForChunks: boolean;
    /**
     * The version of the chunk splitter to use.
     */
    chunkSplitterVersion: ChunkSplitterVersion;
}
/**
 * Settings for on-demand chunk fetching.
 */
interface OnDemandChunkSettings {
    /**
     * Indicates whether chunks should be fetch online. (means replication transfers only metadata).
     */
    readChunksOnline: boolean;
    /**
     * Indicates whether to use only local chunks without fetching online.
     */
    useOnlyLocalChunk: boolean;
    /**
     * The number of concurrent chunk reads allowed when fetching online.
     */
    concurrencyOfReadChunksOnline: number;
    /**
     * The minimum interval (in milliseconds) between consecutive online chunk fetching.
     */
    minimumIntervalOfReadChunksOnline: number;
}
/**
 * Configuration settings for Eden.
 */
interface EdenSettings {
    /**
     * Indicates whether Eden is enabled.
     */
    useEden: boolean;
    /**
     * The maximum number of chunks allowed in Eden.
     */
    maxChunksInEden: number;
    /**
     * The maximum total length allowed in Eden.
     */
    maxTotalLengthInEden: number;
    /**
     * The maximum age allowed in Eden.
     */
    maxAgeInEden: number;
}
/**
 * Interface representing obsolete settings for an remote database.
 */
interface ObsoleteRemoteDBSettings {
    /**
     * Indicates whether to check the integrity of the data on save.
     */
    checkIntegrityOnSave: boolean;
    /**
     * Indicates whether to use history tracking.
     * (Now always true)
     */
    useHistory: boolean;
    /**
     * Indicates whether to disable using API of Obsidian.
     * (Now always true: Note: Obsidian cannot handle multiple requests at the same time).
     */
    disableRequestURI: boolean;
    /**
     * Indicates whether to send data in bulk chunks.
     */
    sendChunksBulk: boolean;
    /**
     * The maximum size of the bulk chunks to be sent.
     */
    sendChunksBulkMaxSize: number;
    /**
     * Indicates whether to use a dynamic iteration count.
     */
    useDynamicIterationCount: boolean;
    /**
     * Indicates weather to pace the replication processing interval.
     * Now (v0.24.x) not be respected.
     */
    doNotPaceReplication: boolean;
}
/**
 * Interface representing the settings for beta tweaks for the remote database.
 */
interface BetaRemoteDBSettings {
    /**
     * Indicates whether compression is enabled for the remote database.
     */
    enableCompression: boolean;
}
/**
 * Interface representing the some data stored on the settings.
 */
interface DataOnRemoteDBSettings {
    /**
     * VersionUp flash message which is shown when some incompatible changes are made during the update.
     */
    versionUpFlash: string;
    /**
     * Unix timestamp (ms) of the latest tweak update.
     * Used to determine which side has newer tweak values.
     */
    tweakModified: number | undefined;
}
/**
 * Interface representing the settings for replication.
 */
interface ReplicationSetting {
    /**
     * The maximum number of documents to be processed in a batch.
     */
    batch_size: number;
    /**
     * The maximum number of batches to be processed.
     */
    batches_limit: number;
}
/**
 * Interface representing the settings for targetting files.
 */
interface FileHandlingSettings {
    /**
     * The regular expression for files to be synchronised.
     */
    syncOnlyRegEx: CustomRegExpSourceList<"|[]|">;
    /**
     * The regular expression for files to be ignored during synchronisation.
     */
    syncIgnoreRegEx: CustomRegExpSourceList<"|[]|">;
}
/**
 * Interface representing the settings for processing behaviour.
 */
interface ProcessingBehaviourSettings {
    /**
     * Hash cache maximum count.
     */
    hashCacheMaxCount: number;
    /**
     * Hash cache maximum amount.
     */
    hashCacheMaxAmount: number;
}
/**
 * Interface representing the settings for remote database tweaks.
 */
interface RemoteDBTweakSettings {
    /**
     * Indicates whether to ignore the version check.
     */
    ignoreVersionCheck: boolean;
    /**
     * Indicates whether to ignore and continue syncing even if the configuration-mismatch is detected.
     * (Note: Mismatched settings can lead to inappropriate de-duplication, leading to storage wastage and increased traffic).
     */
    disableCheckingConfigMismatch: boolean;
    /**
     * Automatically accepts compatible-but-lossy tweak mismatches.
     * If undefined, the feature is not configured yet.
     */
    autoAcceptCompatibleTweak: boolean | undefined;
}
/**
 * Interface representing the settings for optional and not exposed remote database settings.
 */
interface OptionalAndNotExposedRemoteDBSettings {
    /**
     * Indicates whether to accept empty passphrase.
     * This not meant to `Not be encrypted`, but `Be encrypted with empty passphrase`.
     */
    permitEmptyPassphrase: boolean;
}
/**
 * Interface representing the settings for cross-platform interoperability.
 */
interface CrossPlatformInteroperabilitySettings {
    /**
     * Indicates whether to handle filename case sensitively.
     */
    handleFilenameCaseSensitive: boolean;
}
/**
 * Interface representing the settings for conflict handling.
 */
interface ConflictHandlingSettings {
    /**
     * Indicates whether to check conflicts only on file open.
     */
    checkConflictOnlyOnOpen: boolean;
    /**
     * Indicates whether to show the merge dialog only on active file.
     */
    showMergeDialogOnlyOnActive: boolean;
}
/**
 * Settings that define the behavior of the merge process.
 */
interface MergeBehaviourSettings {
    /**
     * Indicates whether to synchronise after merging.
     */
    syncAfterMerge: boolean;
    /**
     * Determines if conflicts should be resolved by choosing the newer file.
     */
    resolveConflictsByNewerFile: boolean;
    /**
     * Specifies whether to write documents even if there are conflicts.
     */
    writeDocumentsIfConflicted: boolean;
    /**
     * Disables automatic merging of markdown files.
     */
    disableMarkdownAutoMerge: boolean;
}
/**
 * Configuration settings for handling edge cases in the application.
 */
interface EdgeCaseHandlingSettings {
    /**
     * An optional suffix to append to the database name after the vault name.
     */
    additionalSuffixOfDatabaseName: string | undefined;
    /**
     * Flag to disable the worker thread for generating chunks.
     */
    disableWorkerForGeneratingChunks: boolean;
    /**
     * Flag to process small files in the UI thread instead of a worker thread.
     */
    processSmallFilesInUIThread: boolean;
    /**
     * Indicates whether to use timeout for PouchDB replication.
     */
    useTimeouts: boolean;
}
/**
 * Configuration settings for handling deleted files.
 */
interface DeletedFileMetadataSettings {
    /**
     * Indicates whether to delete metadata of deleted files.
     */
    deleteMetadataOfDeletedFiles: boolean;
    /**
     * The number of days to wait before automatically deleting metadata of deleted files.
     */
    automaticallyDeleteMetadataOfDeletedFiles: number;
}
/**
 * Represents a single remote configuration.
 */
export interface RemoteConfiguration {
    /**
     * Unique identifier for this configuration.
     */
    id: string;
    /**
     * Display name for the configuration.
     */
    name: string;
    /**
     * The connection string (URI) for the remote.
     * This may be an encrypted string if configPassphraseStore is set.
     */
    uri: string;
    /**
     * Indicates whether this configuration is encrypted.
     */
    isEncrypted: boolean;
}
export interface RemoteConfigurations {
    /**
     * The list of remote configurations.
     */
    remoteConfigurations: Record<string, RemoteConfiguration>;
    /**
     * The ID of the currently active remote configuration.
     */
    activeConfigurationId: string;
    /**
     * The ID of the active remote configuration dedicated for P2P features.
     * If empty, P2P features should request explicit selection from the user.
     */
    P2P_ActiveRemoteConfigurationId: string;
}
interface ObsidianLiveSyncSettings_PluginSetting extends SyncMethodSettings, UISettings, FileHandlingSettings, MergeBehaviourSettings, EncryptedUserSettings, PeriodicReplicationSettings, InternalFileSettings, PluginSyncSettings, ModeSettings, ExtraTweakSettings, BetaTweakSettings, ObsoleteSettings, DebugModeSettings, SettingSyncSettings, SafetyValveSettings, DataOnSettings, RemoteConfigurations { // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface -- Empty interface
}
export type RemoteDBSettings = CouchDBConnection & BucketSyncSetting & RemoteTypeSettings & EncryptionSettings & ChunkSettings & EdenSettings & DataOnRemoteDBSettings & ObsoleteRemoteDBSettings & OnDemandChunkSettings & BetaRemoteDBSettings & ReplicationSetting & RemoteDBTweakSettings & FileHandlingSettings & ProcessingBehaviourSettings & OptionalAndNotExposedRemoteDBSettings & CrossPlatformInteroperabilitySettings & ConflictHandlingSettings & EdgeCaseHandlingSettings & DeletedFileMetadataSettings & P2PSyncSetting & RemoteConfigurations;
export type ObsidianLiveSyncSettings = ObsidianLiveSyncSettings_PluginSetting & RemoteDBSettings & LocalDBSettings;
export interface HasSettings<T extends Partial<ObsidianLiveSyncSettings>> {
    settings: T;
}
export {};
