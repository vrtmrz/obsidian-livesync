import { $t } from "../../../lib/src/common/i18n.ts";
import {
    DEFAULT_SETTINGS,
    configurationNames,
    type ConfigurationItem,
    type FilterBooleanKeys,
    type FilterNumberKeys,
    type FilterStringKeys,
    type ObsidianLiveSyncSettings,
} from "../../../lib/src/common/types.ts";

export type OnDialogSettings = {
    configPassphrase: string;
    preset: "" | "PERIODIC" | "LIVESYNC" | "DISABLE";
    syncMode: "ONEVENTS" | "PERIODIC" | "LIVESYNC";
    dummy: number;
    deviceAndVaultName: string;
};

export const OnDialogSettingsDefault: OnDialogSettings = {
    configPassphrase: "",
    preset: "",
    syncMode: "ONEVENTS",
    dummy: 0,
    deviceAndVaultName: "",
};
export const AllSettingDefault = { ...DEFAULT_SETTINGS, ...OnDialogSettingsDefault };

export type AllSettings = ObsidianLiveSyncSettings & OnDialogSettings;
export type AllStringItemKey = FilterStringKeys<AllSettings>;
export type AllNumericItemKey = FilterNumberKeys<AllSettings>;
export type AllBooleanItemKey = FilterBooleanKeys<AllSettings>;
export type AllSettingItemKey = AllStringItemKey | AllNumericItemKey | AllBooleanItemKey;

export type ValueOf<T extends AllSettingItemKey> = T extends AllStringItemKey
    ? string
    : T extends AllNumericItemKey
      ? number
      : T extends AllBooleanItemKey
        ? boolean
        : AllSettings[T];

export const SettingInformation: Partial<Record<keyof AllSettings, ConfigurationItem>> = {
    liveSync: {
        name: "Sync Mode",
    },
    couchDB_URI: {
        name: "Server URI",
        placeHolder: "https://........",
    },
    couchDB_USER: {
        name: "Username",
        desc: "username",
    },
    couchDB_PASSWORD: {
        name: "Password",
        desc: "password",
    },
    couchDB_DBNAME: {
        name: "Database Name",
    },
    passphrase: {
        name: "Passphrase",
        desc: "Encryption phassphrase. If changed, you should overwrite the server's database with the new (encrypted) files.",
    },
    showStatusOnEditor: {
        name: "Show status inside the editor",
        desc: "Requires restart of Obsidian.",
    },
    showOnlyIconsOnEditor: {
        name: "Show status as icons only",
    },
    showStatusOnStatusbar: {
        name: "Show status on the status bar",
        desc: "Requires restart of Obsidian.",
    },
    lessInformationInLog: {
        name: "Show only notifications",
        desc: "Disables logging, only shows notifications. Please disable if you report an issue.",
    },
    showVerboseLog: {
        name: "Verbose Log",
        desc: "Show verbose log. Please enable if you report an issue.",
    },
    hashCacheMaxCount: {
        name: "Memory cache size (by total items)",
    },
    hashCacheMaxAmount: {
        name: "Memory cache size (by total characters)",
        desc: "(Mega chars)",
    },
    writeCredentialsForSettingSync: {
        name: "Write credentials in the file",
        desc: "(Not recommended) If set, credentials will be stored in the file.",
    },
    notifyAllSettingSyncFile: {
        name: "Notify all setting files",
    },
    configPassphrase: {
        name: "Passphrase of sensitive configuration items",
        desc: "This passphrase will not be copied to another device. It will be set to `Default` until you configure it again.",
    },
    configPassphraseStore: {
        name: "Encrypting sensitive configuration items",
    },
    syncOnSave: {
        name: "Sync on Save",
        desc: "Starts synchronisation when a file is saved.",
    },
    syncOnEditorSave: {
        name: "Sync on Editor Save",
        desc: "When you save a file in the editor, start a sync automatically",
    },
    syncOnFileOpen: {
        name: "Sync on File Open",
        desc: "Forces the file to be synced when opened.",
    },
    syncOnStart: {
        name: "Sync on Startup",
        desc: "Automatically Sync all files when opening Obsidian.",
    },
    syncAfterMerge: {
        name: "Sync after merging file",
        desc: "Sync automatically after merging files",
    },
    trashInsteadDelete: {
        name: "Use the trash bin",
        desc: "Move remotely deleted files to the trash, instead of deleting.",
    },
    doNotDeleteFolder: {
        name: "Keep empty folder",
        desc: "Should we keep folders that don't have any files inside?",
    },
    resolveConflictsByNewerFile: {
        name: "(BETA) Always overwrite with a newer file",
        desc: "Testing only - Resolve file conflicts by syncing newer copies of the file, this can overwrite modified files. Be Warned.",
    },
    checkConflictOnlyOnOpen: {
        name: "Delay conflict resolution of inactive files",
        desc: "Should we only check for conflicts when a file is opened?",
    },
    showMergeDialogOnlyOnActive: {
        name: "Delay merge conflict prompt for inactive files.",
        desc: "Should we prompt you about conflicting files when a file is opened?",
    },
    disableMarkdownAutoMerge: {
        name: "Always prompt merge conflicts",
        desc: "Should we prompt you for every single merge, even if we can safely merge automatcially?",
    },
    writeDocumentsIfConflicted: {
        name: "Apply Latest Change if Conflicting",
        desc: "Enable this option to automatically apply the most recent change to documents even when it conflicts",
    },
    syncInternalFilesInterval: {
        name: "Scan hidden files periodically",
        desc: "Seconds, 0 to disable",
    },
    batchSave: {
        name: "Batch database update",
        desc: "Reducing the frequency with which on-disk changes are reflected into the DB",
    },
    readChunksOnline: {
        name: "Fetch chunks on demand",
        desc: "(ex. Read chunks online) If this option is enabled, LiveSync reads chunks online directly instead of replicating them locally. Increasing Custom chunk size is recommended.",
    },
    syncMaxSizeInMB: {
        name: "Maximum file size",
        desc: "(MB) If this is set, changes to local and remote files that are larger than this will be skipped. If the file becomes smaller again, a newer one will be used.",
    },
    useIgnoreFiles: {
        name: "(Beta) Use ignore files",
        desc: "If this is set, changes to local files which are matched by the ignore files will be skipped. Remote changes are determined using local ignore files.",
    },
    ignoreFiles: {
        name: "Ignore files",
        desc: "Comma separated `.gitignore, .dockerignore`",
    },
    batch_size: {
        name: "Batch size",
        desc: "Number of changes to sync at a time. Defaults to 50. Minimum is 2.",
    },
    batches_limit: {
        name: "Batch limit",
        desc: "Number of batches to process at a time. Defaults to 40. Minimum is 2. This along with batch size controls how many docs are kept in memory at a time.",
    },
    useTimeouts: {
        name: "Use timeouts instead of heartbeats",
        desc: "If this option is enabled, PouchDB will hold the connection open for 60 seconds, and if no change arrives in that time, close and reopen the socket, instead of holding it open indefinitely. Useful when a proxy limits request duration but can increase resource usage.",
    },
    concurrencyOfReadChunksOnline: {
        name: "Batch size of on-demand fetching",
    },
    minimumIntervalOfReadChunksOnline: {
        name: "The delay for consecutive on-demand fetches",
    },
    suspendFileWatching: {
        name: "Suspend file watching",
        desc: "Stop watching for file changes.",
    },
    suspendParseReplicationResult: {
        name: "Suspend database reflecting",
        desc: "Stop reflecting database changes to storage files.",
    },
    writeLogToTheFile: {
        name: "Write logs into the file",
        desc: "Warning! This will have a serious impact on performance. And the logs will not be synchronised under the default name. Please be careful with logs; they often contain your confidential information.",
    },
    deleteMetadataOfDeletedFiles: {
        name: "Do not keep metadata of deleted files.",
    },
    useIndexedDBAdapter: {
        name: "(Obsolete) Use an old adapter for compatibility",
        desc: "Before v0.17.16, we used an old adapter for the local database. Now the new adapter is preferred. However, it needs local database rebuilding. Please disable this toggle when you have enough time. If leave it enabled, also while fetching from the remote database, you will be asked to disable this.",
        obsolete: true,
    },
    watchInternalFileChanges: {
        name: "Scan changes on customization sync",
        desc: "Do not use internal API",
    },
    doNotSuspendOnFetching: {
        name: "Fetch database with previous behaviour",
    },
    disableCheckingConfigMismatch: {
        name: "Do not check configuration mismatch before replication",
    },
    usePluginSync: {
        name: "Enable customization sync",
    },
    autoSweepPlugins: {
        name: "Scan customization automatically",
        desc: "Scan customization before replicating.",
    },
    autoSweepPluginsPeriodic: {
        name: "Scan customization periodically",
        desc: "Scan customization every 1 minute.",
    },
    notifyPluginOrSettingUpdated: {
        name: "Notify customized",
        desc: "Notify when other device has newly customized.",
    },
    remoteType: {
        name: "Remote Type",
        desc: "Remote server type",
    },
    endpoint: {
        name: "Endpoint URL",
        placeHolder: "https://........",
    },
    accessKey: {
        name: "Access Key",
    },
    secretKey: {
        name: "Secret Key",
    },
    region: {
        name: "Region",
        placeHolder: "auto",
    },
    bucket: {
        name: "Bucket Name",
    },
    useCustomRequestHandler: {
        name: "Use Custom HTTP Handler",
        desc: "Enable this if your Object Storage doesn't support CORS",
    },
    maxChunksInEden: {
        name: "Maximum Incubating Chunks",
        desc: "The maximum number of chunks that can be incubated within the document. Chunks exceeding this number will immediately graduate to independent chunks.",
    },
    maxTotalLengthInEden: {
        name: "Maximum Incubating Chunk Size",
        desc: "The maximum total size of chunks that can be incubated within the document. Chunks exceeding this size will immediately graduate to independent chunks.",
    },
    maxAgeInEden: {
        name: "Maximum Incubation Period",
        desc: "The maximum duration for which chunks can be incubated within the document. Chunks exceeding this period will graduate to independent chunks.",
    },
    settingSyncFile: {
        name: "Filename",
        desc: "Save settings to a markdown file. You will be notified when new settings arrive. You can set different files by the platform.",
    },
    preset: {
        name: "Presets",
        desc: "Apply preset configuration",
    },
    syncMode: {
        name: "Sync Mode",
    },
    periodicReplicationInterval: {
        name: "Periodic Sync interval",
        desc: "Interval (sec)",
    },
    syncInternalFilesBeforeReplication: {
        name: "Scan for hidden files before replication",
    },
    automaticallyDeleteMetadataOfDeletedFiles: {
        name: "Delete old metadata of deleted files on start-up",
        desc: "(Days passed, 0 to disable automatic-deletion)",
    },
    additionalSuffixOfDatabaseName: {
        name: "Database suffix",
        desc: "LiveSync could not handle multiple vaults which have same name without different prefix, This should be automatically configured.",
    },
    hashAlg: {
        name: configurationNames["hashAlg"]?.name || "",
        desc: "xxhash64 is the current default.",
    },
    deviceAndVaultName: {
        name: "Device name",
        desc: "Unique name between all synchronized devices. To edit this setting, please disable customization sync once.",
    },
    displayLanguage: {
        name: "Display Language",
        desc: 'Not all messages have been translated. And, please revert to "Default" when reporting errors.',
    },
    enableChunkSplitterV2: {
        name: "Use splitting-limit-capped chunk splitter",
        desc: "If enabled, chunks will be split into no more than 100 items. However, dedupe is slightly weaker.",
    },
    disableWorkerForGeneratingChunks: {
        name: "Do not split chunks in the background",
        desc: "If disabled(toggled), chunks will be split on the UI thread (Previous behaviour).",
    },
    processSmallFilesInUIThread: {
        name: "Process small files in the foreground",
        desc: "If enabled, the file under 1kb will be processed in the UI thread.",
    },
    batchSaveMinimumDelay: {
        name: "Minimum delay for batch database updating",
        desc: "Seconds. Saving to the local database will be delayed until this value after we stop typing or saving.",
    },
    batchSaveMaximumDelay: {
        name: "Maximum delay for batch database updating",
        desc: "Saving will be performed forcefully after this number of seconds.",
    },
    notifyThresholdOfRemoteStorageSize: {
        name: "Notify when the estimated remote storage size exceeds on start up",
        desc: "MB (0 to disable).",
    },
    usePluginSyncV2: {
        name: "Enable per-file customization sync",
        desc: "If enabled, efficient per-file customization sync will be used. A minor migration is required when enabling this feature, and all devices must be updated to v0.23.18. Enabling this feature will result in losing compatibility with older versions.",
    },
    handleFilenameCaseSensitive: {
        name: "Handle files as Case-Sensitive",
        desc: "If this enabled, All files are handled as case-Sensitive (Previous behaviour).",
    },
    doNotUseFixedRevisionForChunks: {
        name: "Compute revisions for chunks (Previous behaviour)",
        desc: "If this enabled, all chunks will be stored with the revision made from its content. (Previous behaviour)",
    },
    sendChunksBulkMaxSize: {
        name: "Maximum size of chunks to send in one request",
        desc: "MB",
    },
    useAdvancedMode: {
        name: "Enable advanced features",
        // desc: "Enable advanced mode"
    },
    usePowerUserMode: {
        name: "Enable poweruser features",
        // desc: "Enable power user mode",
        // level: LEVEL_ADVANCED
    },
    useEdgeCaseMode: {
        name: "Enable edge case treatment features",
    },
    enableDebugTools: {
        name: "Enable Developers' Debug Tools.",
        desc: "Requires restart of Obsidian",
    },
};
function translateInfo(infoSrc: ConfigurationItem | undefined | false) {
    if (!infoSrc) return false;
    const info = { ...infoSrc };
    info.name = $t(info.name);
    if (info.desc) {
        info.desc = $t(info.desc);
    }
    return info;
}
function _getConfig(key: AllSettingItemKey) {
    if (key in configurationNames) {
        return configurationNames[key as keyof ObsidianLiveSyncSettings];
    }
    if (key in SettingInformation) {
        return SettingInformation[key as keyof ObsidianLiveSyncSettings];
    }
    return false;
}
export function getConfig(key: AllSettingItemKey) {
    return translateInfo(_getConfig(key));
}
export function getConfName(key: AllSettingItemKey) {
    const conf = getConfig(key);
    if (!conf) return `${key} (No info)`;
    return conf.name;
}
