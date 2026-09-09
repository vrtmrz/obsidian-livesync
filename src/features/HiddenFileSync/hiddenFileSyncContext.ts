import {
    type AnyEntry,
    type LoadedEntry,
    type FilePathWithPrefix,
    type FilePath,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type MetaEntry,
    type ObsidianLiveSyncSettings,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ICHeader, ICHeaderEnd } from "@/common/types.ts";
import { type CustomRegExp } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { isInternalMetadata, cancelTask, scheduleTask } from "@/common/utils.ts";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { addPrefix, stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { configureHiddenFileSyncMode, type ConfigureHiddenFileSyncResult } from "./configureHiddenFileSyncMode.ts";
import type { OptionalSyncFeatureMode } from "@/features/optionalSyncFeatures.ts";
import { $msg } from "@/common/translation";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type { KeyValueDatabase } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import {
    createHiddenFileSyncRepairView,
    createHiddenFileSyncServiceHandlerView,
    createHiddenFileSyncTestingView,
    type HiddenFileSyncCommandView,
    type HiddenFileSyncRepairView,
    type HiddenFileSyncServiceHandlerView,
    type HiddenFileSyncTestingView,
} from "./hiddenFileSyncViews.ts";
import type { OptionalFileSyncFileTreeDependencies } from "@/features/optionalFileSyncFileTree.ts";
import {
    deleteHiddenFileFromStorage,
    ensureHiddenFileDirectory,
    readHiddenFileWithInfo,
    triggerHiddenFileEvent,
    writeHiddenFile,
    writeHiddenFileFromDatabase,
    type HiddenFileSyncStorageDependencies,
} from "./hiddenFileSyncStorage.ts";
import { loadHiddenFileSyncBaseEntry, loadLiveHiddenFileSyncRevision } from "./hiddenFileSyncDatabaseLoaders.ts";
import {
    createHiddenFileSyncDatabaseWriteOperations,
    type HiddenFileSyncDatabaseWriteOperations,
} from "./hiddenFileSyncDatabaseWriteOperations.ts";
import {
    createHiddenFileSyncDatabaseExtractionOperations,
    type HiddenFileSyncDatabaseExtractionOperations,
} from "./hiddenFileSyncDatabaseExtractionOperations.ts";
import {
    createHiddenFileSyncConflictResolution,
    type HiddenFileSyncConflictResolution,
    type HiddenFileSyncJsonResolution,
} from "./hiddenFileSyncConflictResolution.ts";
import {
    createHiddenFileSyncProcessedState,
    type HiddenFileSyncProcessedState,
} from "./hiddenFileSyncProcessedState.ts";
import {
    createHiddenFileSyncChangeProcessor,
    type HiddenFileSyncChangeProcessor,
} from "./hiddenFileSyncChangeProcessor.ts";
import { createHiddenFileSyncPathAdmission, type HiddenFileSyncPathAdmission } from "./hiddenFileSyncPathAdmission.ts";
import {
    createHiddenFileSyncChangeNotifier,
    type HiddenFileSyncChangeNotifier,
} from "./hiddenFileSyncChangeNotifier.ts";
import {
    createReconciliation,
    type InitialisationDirection,
    type ReconciliationProgress,
    type Reconciliation,
} from "./reconciliation.ts";

export type { ReconciliationProgress as HiddenFileSyncProgress } from "./reconciliation.ts";
type SyncDirection = InitialisationDirection;

type HiddenFileSyncSettings = Pick<
    ObsidianLiveSyncSettings,
    | "syncInternalFiles"
    | "syncInternalFilesBeforeReplication"
    | "watchInternalFileChanges"
    | "useAdvancedMode"
    | "syncInternalFilesInterval"
    | "syncInternalFileOverwritePatterns"
    | "syncInternalFilesTargetPatterns"
    | "syncInternalFilesIgnorePatterns"
    | "suppressNotifyHiddenFilesChange"
>;

type HiddenFileSyncDatabase = Pick<
    LiveSyncLocalDB,
    | "allDocsRaw"
    | "deleteDBEntry"
    | "findEntries"
    | "getDBEntry"
    | "getDBEntryFromMeta"
    | "getDBEntryMeta"
    | "getRaw"
    | "putDBEntry"
    | "putRaw"
    | "removeRevision"
> & {
    readonly managers: {
        readonly conflictManager: Pick<LiveSyncLocalDB["managers"]["conflictManager"], "mergeObject">;
    };
};

type HiddenFileSyncDatabaseFileAccess = Pick<
    DatabaseFileAccess,
    "fetchEntryFromMeta" | "fetchEntryMeta" | "getConflictedRevs" | "storeWithBaseRevision"
>;

export type HiddenFileSyncPeriodicProcessor = {
    enable(interval: number): void;
    disable(): void;
};

export type HiddenFileSyncContextDependencies = OptionalFileSyncFileTreeDependencies &
    HiddenFileSyncStorageDependencies & {
        getSettings(): HiddenFileSyncSettings;
        getLocalDatabase(): HiddenFileSyncDatabase;
        getKeyValueDatabase(): KeyValueDatabase;
        databaseFileAccess: HiddenFileSyncDatabaseFileAccess;
        path: Pick<IPathService, "getPath" | "markChangesAreSame" | "path2id" | "unmarkChanges">;
        createProgress(prefix?: string, level?: LOG_LEVEL): ReconciliationProgress;
        createPeriodicProcessor(process: () => Promise<unknown>): HiddenFileSyncPeriodicProcessor;
        isReady(): boolean;
        isSuspended(): boolean;
        isDatabaseReady(): boolean;
        isIgnoredByIgnoreFile(path: string): Promise<boolean>;
        getConfigDir(): string;
        getRootPath(): string;
        getFileRegExp(
            key:
                | "syncInternalFileOverwritePatterns"
                | "syncInternalFilesIgnorePatterns"
                | "syncInternalFilesTargetPatterns"
        ): CustomRegExp[];
        applySettings(partial: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean): Promise<void>;
        setSyncInternalFilesEnabled(enabled: boolean): void;
        resolveJsonConflict(
            path: FilePath,
            docs: [LoadedEntry, LoadedEntry],
            apply: (resolution: HiddenFileSyncJsonResolution) => Promise<boolean>
        ): Promise<boolean>;
        showConfigurationChangeNotice(updatedFolders: readonly string[]): void;
        hideConfigurationChangeNotice(): void;
        closeJsonConflictDialogs(): void;
        publishActivity(eventCount: number, processingCount: number): void;
        ownsLocalFile(path: FilePath): boolean;
    };

export class HiddenFileSyncContext implements HiddenFileSyncCommandView {
    private readonly dependencies: HiddenFileSyncContextDependencies;
    private readonly processedState: HiddenFileSyncProcessedState;
    private readonly databaseWriteOperations: HiddenFileSyncDatabaseWriteOperations;
    private readonly databaseExtractionOperations: HiddenFileSyncDatabaseExtractionOperations;
    private readonly conflictResolution: HiddenFileSyncConflictResolution;
    private readonly changeProcessor: HiddenFileSyncChangeProcessor;
    private readonly reconciliation: Reconciliation;
    private readonly pathAdmission: HiddenFileSyncPathAdmission;
    private readonly changeNotifier: HiddenFileSyncChangeNotifier;
    readonly serviceHandlers: HiddenFileSyncServiceHandlerView;
    readonly testing: HiddenFileSyncTestingView;
    readonly repair: HiddenFileSyncRepairView;
    private readonly periodicInternalFileScanProcessor: HiddenFileSyncPeriodicProcessor;
    private disposed = false;

    constructor(dependencies: HiddenFileSyncContextDependencies) {
        this.dependencies = dependencies;
        this.pathAdmission = createHiddenFileSyncPathAdmission({
            getTargetPatternSource: () => dependencies.getSettings().syncInternalFilesTargetPatterns,
            getIgnorePatternSource: () => dependencies.getSettings().syncInternalFilesIgnorePatterns,
            getFileRegExp: (key) => dependencies.getFileRegExp(key),
            isIgnoredByIgnoreFile: async (path) => await dependencies.isIgnoredByIgnoreFile(path),
            ownsLocalFile: (path) => dependencies.ownsLocalFile(path),
        });
        this.changeNotifier = createHiddenFileSyncChangeNotifier({
            getSettings: () => dependencies.getSettings(),
            getConfigDir: () => dependencies.getConfigDir(),
            scheduleTask: (key, timeout, operation) => scheduleTask(key, timeout, operation),
            cancelTask: (key) => cancelTask(key),
            showConfigurationChangeNotice: (updatedFolders) =>
                dependencies.showConfigurationChangeNotice(updatedFolders),
            hideConfigurationChangeNotice: () => dependencies.hideConfigurationChangeNotice(),
        });
        this.processedState = createHiddenFileSyncProcessedState({
            getKeyValueDatabase: () => this.dependencies.getKeyValueDatabase(),
            getLocalDatabase: () => this.dependencies.getLocalDatabase(),
            storageAccess: this.dependencies.storageAccess,
            path: this.dependencies.path,
            log: (message, level, key) => this.dependencies.log(message, level, key),
        });
        this.databaseWriteOperations = createHiddenFileSyncDatabaseWriteOperations({
            serialiseFileOperation: async (key, operation) => await serialized(key, operation),
            isIgnoredByIgnoreFile: async (path) => await dependencies.isIgnoredByIgnoreFile(path),
            readFileWithInfo: async (path) => await readHiddenFileWithInfo(dependencies, path),
            loadBaseEntry: async (path) => await loadHiddenFileSyncBaseEntry(dependencies, path, true),
            loadBaseMetadata: async (path) => await loadHiddenFileSyncBaseEntry(dependencies, path, false),
            loadLiveRevision: async (path, revision) =>
                await loadLiveHiddenFileSyncRevision(dependencies, path, revision),
            fetchEntryFromMeta: async (meta, waitForReady, skipCheck) =>
                await dependencies.databaseFileAccess.fetchEntryFromMeta(meta, waitForReady, skipCheck),
            storeWithBaseRevision: async (file, baseRevision, skipCheck) =>
                await dependencies.databaseFileAccess.storeWithBaseRevision(file, baseRevision, skipCheck),
            putDatabaseEntry: async (entry) => await dependencies.getLocalDatabase().putDBEntry(entry),
            putRaw: async (entry) => await dependencies.getLocalDatabase().putRaw(entry),
            removeRevision: async (id, revision) => await dependencies.getLocalDatabase().removeRevision(id, revision),
            processedState: this.processedState,
            now: () => new Date().getTime(),
            log: (message, level, key) => dependencies.log(message, level, key),
        });
        this.databaseExtractionOperations = createHiddenFileSyncDatabaseExtractionOperations({
            serialiseFileOperation: async (key, operation) => await serialized(key, operation),
            isIgnoredByIgnoreFile: async (path) => await dependencies.isIgnoredByIgnoreFile(path),
            loadDatabaseMetadata: async (path) =>
                await dependencies.getLocalDatabase().getDBEntryMeta(path, { conflicts: true }, true),
            loadLiveRevision: async (path, revision) =>
                await loadLiveHiddenFileSyncRevision(dependencies, path, revision),
            loadDatabaseEntry: async (entry) =>
                await dependencies.getLocalDatabase().getDBEntryFromMeta(entry, false, true),
            statStorageFile: async (path) => await dependencies.storageAccess.statHidden(path),
            writeStorageFile: async (path, entry, force) =>
                await writeHiddenFileFromDatabase(dependencies, path, entry, force),
            deleteStorageFile: async (path) => await deleteHiddenFileFromStorage(dependencies, path),
            processedState: this.processedState,
            queueNotification: (path) => this.changeNotifier.queueNotification(path),
            log: (message, level, key) => dependencies.log(message, level, key),
        });
        this.conflictResolution = createHiddenFileSyncConflictResolution({
            database: {
                scanConflictedEntries: () =>
                    dependencies.getLocalDatabase().findEntries(ICHeader, ICHeaderEnd, { conflicts: true }),
                getDocumentId: async (path) => await dependencies.path.path2id(path, ICHeader),
                loadCurrentMetadata: async (id) =>
                    await dependencies.getLocalDatabase().getRaw<MetaEntry>(id, { conflicts: true }),
                loadConflictingMetadata: async (id, revision) =>
                    await dependencies.getLocalDatabase().getRaw<MetaEntry>(id, { rev: revision }),
                loadRevisionHistory: async (id) =>
                    await dependencies.getLocalDatabase().getRaw(id, { revs_info: true }),
                loadRevisionEntry: async (path, revision) =>
                    await dependencies.getLocalDatabase().getDBEntry(addPrefix(path, ICHeader), { rev: revision }),
                mergeJson: async (path, baseRevision, currentRevision, conflictedRevision) =>
                    await dependencies
                        .getLocalDatabase()
                        .managers.conflictManager.mergeObject(path, baseRevision, currentRevision, conflictedRevision),
                removeRevision: async (id, revision) =>
                    await dependencies.getLocalDatabase().removeRevision(id, revision),
                deleteRevision: async (entry) =>
                    await dependencies.getLocalDatabase().deleteDBEntry(dependencies.path.getPath(entry), {
                        rev: entry._rev,
                    }),
            },
            storage: {
                ensureDirectory: async (path) => await ensureHiddenFileDirectory(dependencies, path),
                writeFile: async (path, data) => await writeHiddenFile(dependencies, path, data),
                triggerEvent: async (path) => await triggerHiddenFileEvent(dependencies, path),
            },
            reconciliation: {
                storeFile: async (file, forceWrite) => await this.databaseWriteOperations.store(file, forceWrite),
                extractFile: async (path) => await this.databaseExtractionOperations.extract(path),
            },
            interaction: {
                resolveJsonConflict: async (path, docs, apply) =>
                    await dependencies.resolveJsonConflict(path, docs, apply),
            },
            shouldOverwrite: (path) =>
                dependencies.getFileRegExp("syncInternalFileOverwritePatterns").some((pattern) => pattern.test(path)),
            log: (message, level, key) => dependencies.log(message, level, key),
        });
        this.changeProcessor = createHiddenFileSyncChangeProcessor({
            storageAccess: dependencies.storageAccess,
            readFileWithInfo: async (path) => await readHiddenFileWithInfo(dependencies, path),
            loadDatabaseMetadata: async (path) =>
                await dependencies.getLocalDatabase().getDBEntryMeta(path, { conflicts: true }, true),
            databaseWriteOperations: this.databaseWriteOperations,
            databaseExtractionOperations: this.databaseExtractionOperations,
            processedState: this.processedState,
            conflictResolution: this.conflictResolution,
            log: (message, level, key) => dependencies.log(message, level, key),
            publishActivity: (eventCount, processingCount) => dependencies.publishActivity(eventCount, processingCount),
        });
        this.reconciliation = createReconciliation({
            listFiles: async (path) => await dependencies.listFiles(path),
            getLocalDatabase: () => dependencies.getLocalDatabase(),
            storageAccess: dependencies.storageAccess,
            getRootPath: () => dependencies.getRootPath(),
            getPath: (entry) => dependencies.path.getPath(entry),
            isTargetFile: async (path) => await this.pathAdmission.isTargetFile(path),
            isIgnoredByIgnoreFile: async (path) => await dependencies.isIgnoredByIgnoreFile(path),
            createProgress: (prefix, level) => dependencies.createProgress(prefix, level),
            processedState: this.processedState,
            changeProcessor: this.changeProcessor,
            log: (message, level, key) => dependencies.log(message, level, key),
        });
        this.repair = createHiddenFileSyncRepairView({
            scanInternalFiles: async () => await this.reconciliation.scanInternalFiles(),
            storeInternalFileToDatabase: async (file, forceWrite) =>
                await this.databaseWriteOperations.store(file, forceWrite),
            storeInternalFileToDatabaseWithBaseRevision: async (file, baseRevision, createIfDifferent) =>
                await this.databaseWriteOperations.storeWithBaseRevision(file, baseRevision, createIfDifferent),
            extractInternalFileRevisionFromDatabase: async (storageFilePath, revision, force) =>
                await this.databaseExtractionOperations.extractRevision(storageFilePath, revision, force),
        });
        this.serviceHandlers = createHiddenFileSyncServiceHandlerView({
            processOptionalFileEvent: async (path) => await this.processOptionalFileEvent(path),
            processOptionalSyncFiles: async (doc) => await this.processOptionalSyncFiles(doc),
            onSettingLoaded: async () => await this.onSettingLoaded(),
            realiseSettingSyncMode: async () => await this.realiseSettingSyncMode(),
            onResuming: async () => await this.onResuming(),
            beforeReplicate: async (showNotice) => await this.beforeReplicate(showNotice),
            onDatabaseInitialised: async (showNotice) => await this.onDatabaseInitialised(showNotice),
            suspendExtraSync: async () => await this.suspendExtraSync(),
            configureOptionalSyncFeature: async (mode) => await this.configureOptionalSyncFeature(mode),
            isTargetFileEligible: async (path) => await this.pathAdmission.isTargetFileEligible(path),
            queueConflict: async (path) => await this.queueConflict(path),
        });
        this.testing = createHiddenFileSyncTestingView({
            isManualCommandAvailable: () => this.isManualCommandAvailable(),
            scanAllStorageChanges: async (showNotice) => await this.scanAllStorageChanges(showNotice),
            scanAllDatabaseChanges: async (showNotice) => await this.scanAllDatabaseChanges(showNotice),
            applyOfflineChanges: async (showNotice) => await this.applyOfflineChanges(showNotice),
            updateSettingCache: () => this.updateSettingCache(),
            initialiseInternalFileSync: async (direction, showMessage, targetFiles) =>
                await this.initialiseInternalFileSync(direction, showMessage, targetFiles),
            conflictResolution: this.conflictResolution.testing,
            readFileWithInfo: async (path) => await readHiddenFileWithInfo(dependencies, path),
            showConfigurationChangeNotice: (updatedFolders) =>
                this.changeNotifier.showConfigurationChangeNotice(updatedFolders),
            interceptRebuildMerging: (interceptor) => this.reconciliation.interceptRebuildMerging(interceptor),
        });
        this.periodicInternalFileScanProcessor = dependencies.createPeriodicProcessor(
            async () =>
                this.isThisModuleEnabled() && this._isDatabaseReady() && (await this.scanAllStorageChanges(false))
        );
    }

    private get settings() {
        return this.dependencies.getSettings();
    }

    private getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.dependencies.path.getPath(entry);
    }

    private _isMainReady() {
        return this.dependencies.isReady();
    }

    private _isMainSuspended() {
        return this.dependencies.isSuspended();
    }

    private _isDatabaseReady() {
        return this.dependencies.isDatabaseReady();
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string) {
        this.dependencies.log(message, level, key);
    }

    private _progress(prefix: string = "", level: LOG_LEVEL = LOG_LEVEL_NOTICE) {
        return this.dependencies.createProgress(prefix, level);
    }

    private isThisModuleEnabled() {
        return this.settings.syncInternalFiles;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.periodicInternalFileScanProcessor?.disable();
        this.changeProcessor.dispose();
        this.reconciliation.dispose();
        this.conflictResolution.dispose();
        this.pathAdmission.dispose();
        this.changeNotifier.dispose();
        this.dependencies.closeJsonConflictDialogs();
    }

    // The key-value database becomes available before this lifecycle callback.
    private async onDatabaseInitialised(showNotice: boolean) {
        await this.processedState.initialise();
        if (this.isThisModuleEnabled()) {
            if (this.processedState.getLastProcessedFileCount() == 0) {
                this._log(`No cache found. Performing startup scan.`, LOG_LEVEL_VERBOSE);
                await this.applyOfflineChanges(true);
            } else {
                await this.applyOfflineChanges(showNotice);
            }
        }
        return true;
    }
    private async beforeReplicate(showNotice: boolean) {
        if (
            this.isThisModuleEnabled() &&
            this._isDatabaseReady() &&
            this.settings.syncInternalFilesBeforeReplication &&
            !this.settings.watchInternalFileChanges
        ) {
            await this.scanAllStorageChanges(showNotice);
        }
        return true;
    }

    private onSettingLoaded(): Promise<boolean> {
        this.updateSettingCache();
        return Promise.resolve(true);
    }

    updateSettingCache() {
        this.pathAdmission.invalidatePatternCache();
    }

    private isReady() {
        if (this.disposed) return false;
        if (!this._isMainReady()) return false;
        if (this._isMainSuspended()) return false;
        if (!this.isThisModuleEnabled()) return false;
        return true;
    }

    isManualCommandAvailable() {
        return this.settings.useAdvancedMode && this.isReady() && this._isDatabaseReady();
    }

    private async onResuming(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return true;
        if (this.isThisModuleEnabled()) {
            await this.applyOfflineChanges(false);
        }
        this.periodicInternalFileScanProcessor.enable(
            this.isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        return true;
    }

    private realiseSettingSyncMode(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return Promise.resolve(true);
        if (!this._isMainReady()) return Promise.resolve(true);
        this.periodicInternalFileScanProcessor.enable(
            this.isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        this.pathAdmission.invalidatePatternCache();
        return Promise.resolve(true);
    }

    private async processOptionalFileEvent(path: FilePath): Promise<boolean> {
        if (this.isReady()) {
            return (await this.reconciliation.processStorageChange(path)) || false;
        }
        return false;
    }

    private async processOptionalSyncFiles(doc: LoadedEntry): Promise<boolean> {
        if (isInternalMetadata(doc._id)) {
            if (this.isThisModuleEnabled()) {
                //system file
                const filename = this.getPath(doc);
                const unprefixedPath = stripAllPrefixes(filename);
                if (!(await this.pathAdmission.isTargetFile(stripAllPrefixes(unprefixedPath)))) {
                    this._log(
                        `Skipped processing sync file:${unprefixedPath} (Not Hidden File Sync target)`,
                        LOG_LEVEL_VERBOSE
                    );
                    // We should return true, we made sure that document is a internalMetadata.
                    return true;
                }
                if (!(await this.reconciliation.processDatabaseDocument(doc))) {
                    this._log(`Failed to process sync file:${unprefixedPath}`, LOG_LEVEL_NOTICE);
                    // Do not yield false, this file had been processed.
                }
            }
            return true;
        }
        return false;
    }

    // --> Database Event Functions

    private queueConflict(path: FilePathWithPrefix): Promise<boolean> {
        this.conflictResolution.queue(path);
        return Promise.resolve(true);
    }

    // <-- Database Event Functions

    async scanAllStorageChanges(
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeleted = true
    ): Promise<unknown> {
        return await this.reconciliation.scanAllStorageChanges(showNotice, onlyNew, forceWriteAll, includeDeleted);
    }

    async scanAllDatabaseChanges(
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeletion = true
    ): Promise<unknown> {
        return await this.reconciliation.scanAllDatabaseChanges(showNotice, onlyNew, forceWriteAll, includeDeletion);
    }

    async applyOfflineChanges(showNotice: boolean): Promise<unknown> {
        return await this.reconciliation.applyOfflineChanges(showNotice);
    }

    async initialiseInternalFileSync(
        direction: SyncDirection,
        showMessage: boolean,
        targetFilesSrc: string[] | false = false,
        initialisationProgress?: ReconciliationProgress
    ): Promise<void> {
        return await this.reconciliation.initialiseInternalFileSync(
            direction,
            showMessage,
            targetFilesSrc,
            initialisationProgress
        );
    }

    // <-- Initialization functions

    private suspendExtraSync(): Promise<boolean> {
        if (this.settings.syncInternalFiles) {
            this._log(
                $msg(
                    "Hidden file synchronization have been temporarily disabled. Please enable them after the fetching, if you need them."
                ),
                LOG_LEVEL_NOTICE
            );
            this.dependencies.setSyncInternalFilesEnabled(false);
        }
        return Promise.resolve(true);
    }

    // --> Configuration handling
    private async configureOptionalSyncFeature(mode: OptionalSyncFeatureMode) {
        await this.configureHiddenFileSync(mode);
        return true;
    }

    private async configureHiddenFileSync(mode: OptionalSyncFeatureMode) {
        let initialisationProgress: ReconciliationProgress | undefined;
        let result: ConfigureHiddenFileSyncResult;
        try {
            result = await configureHiddenFileSyncMode(mode, {
                disable: async () => {
                    await this.dependencies.applySettings(
                        {
                            syncInternalFiles: false,
                        },
                        true
                    );
                },
                enable: async () => {
                    // Open the one user-visible progress Notice before saving
                    // the setting. Large Vaults can otherwise appear idle
                    // before the initial file enumeration begins.
                    initialisationProgress = this._progress("[⚙ Initialise]\n", LOG_LEVEL_NOTICE);
                    initialisationProgress.log("Preparing Hidden File Sync...");
                    await this.dependencies.applySettings(
                        {
                            useAdvancedMode: true,
                            syncInternalFiles: true,
                        },
                        true
                    );
                },
                initialise: async (direction) => {
                    await this.initialiseInternalFileSync(direction, true, false, initialisationProgress);
                    initialisationProgress = undefined;
                },
            });
        } catch (error) {
            initialisationProgress?.done("Failed");
            throw error;
        }
        if (result == "ignored" || result == "disabled") {
            return;
        }
        this._log("Hidden File Sync initialisation completed.", LOG_LEVEL_INFO);
    }
    // <-- Configuration handling

    // <-- Local Storage SubFunctions
}
