import {
    type AnyEntry,
    type LoadedEntry,
    type FilePathWithPrefix,
    type FilePath,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type DocumentID,
    type MetaEntry,
    type ObsidianLiveSyncSettings,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { type InternalFileInfo, ICHeader, ICHeaderEnd } from "@/common/types.ts";
import { type CustomRegExp } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import {
    compareMTime,
    isInternalMetadata,
    TARGET_IS_NEW,
    cancelTask,
    scheduleTask,
    getLogLevel,
    onlyInNTimes,
    BASE_IS_NEW,
    EVEN,
} from "@/common/utils.ts";
import { serialized, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { addPrefix, stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { tryGetFilePath } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
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
    type HiddenFileSyncTestingRebuild,
    type HiddenFileSyncTestingView,
} from "./hiddenFileSyncViews.ts";
import { describeHiddenFileSyncDocument, getHiddenFileSyncComparisonMTime } from "./hiddenFileSyncState.ts";
import {
    collectOptionalFileSyncFiles,
    type OptionalFileSyncFileTreeDependencies,
} from "@/features/optionalFileSyncFileTree.ts";
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
import {
    createHiddenFileSyncPathAdmission,
    type HiddenFileSyncPathAdmission,
} from "./hiddenFileSyncPathAdmission.ts";
import {
    createHiddenFileSyncChangeNotifier,
    type HiddenFileSyncChangeNotifier,
} from "./hiddenFileSyncChangeNotifier.ts";
type SyncDirection = "push" | "pull" | "safe" | "pullForce" | "pushForce";

export type HiddenFileSyncProgress = {
    log(message: string): void;
    once(message: string): void;
    done(message?: string): void;
};

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
        createProgress(prefix?: string, level?: LOG_LEVEL): HiddenFileSyncProgress;
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
    private readonly pathAdmission: HiddenFileSyncPathAdmission;
    private readonly changeNotifier: HiddenFileSyncChangeNotifier;
    readonly serviceHandlers: HiddenFileSyncServiceHandlerView;
    readonly testing: HiddenFileSyncTestingView;
    readonly repair: HiddenFileSyncRepairView;
    private readonly periodicInternalFileScanProcessor: HiddenFileSyncPeriodicProcessor;
    private rebuildMergingHook: HiddenFileSyncTestingRebuild | undefined;
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
        this.repair = createHiddenFileSyncRepairView({
            scanInternalFiles: async () => await this.scanInternalFiles(),
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
            interceptRebuildMerging: (interceptor) => {
                const previousHook = this.rebuildMergingHook;
                const runRebuild = async (showNotice: boolean, targetFiles?: FilePath[] | false) =>
                    await this.rebuildMerging(showNotice, targetFiles);
                const hook: HiddenFileSyncTestingRebuild = async (showNotice, targetFiles) =>
                    await interceptor(runRebuild, showNotice, targetFiles);
                this.rebuildMergingHook = hook;
                return () => {
                    if (this.rebuildMergingHook === hook) {
                        this.rebuildMergingHook = previousHook;
                    }
                };
            },
        });
        this.periodicInternalFileScanProcessor = dependencies.createPeriodicProcessor(
            async () =>
                this.isThisModuleEnabled() && this._isDatabaseReady() && (await this.scanAllStorageChanges(false))
        );
    }

    private get settings() {
        return this.dependencies.getSettings();
    }

    private get localDatabase() {
        return this.dependencies.getLocalDatabase();
    }

    private get storageAccess() {
        return this.dependencies.storageAccess;
    }

    private get databaseFileAccess() {
        return this.dependencies.databaseFileAccess;
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

    private _verbose(message: unknown, key?: string) {
        this._log(message, LOG_LEVEL_VERBOSE, key);
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
        this.conflictResolution.dispose();
        this.pathAdmission.dispose();
        this.changeNotifier.dispose();
        this.rebuildMergingHook = undefined;
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
            return (await this.trackStorageFileModification(path)) || false;
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
                if (!(await this.processReplicationResult(doc))) {
                    this._log(`Failed to process sync file:${unprefixedPath}`, LOG_LEVEL_NOTICE);
                    // Do not yield false, this file had been processed.
                }
            }
            return true;
        }
        return false;
    }

    private async adoptCurrentStorageFilesAsProcessed(targetFiles: FilePath[] | false) {
        const allFiles = await this.scanInternalFileNames();
        const files = targetFiles ? allFiles.filter((e) => targetFiles.some((t) => e.indexOf(t) !== -1)) : allFiles;
        for (const file of files) {
            await this.processedState.updateLastProcessedAsActualFile(file);
        }
    }
    private async adoptCurrentDatabaseFilesAsProcessed(targetFiles: FilePath[] | false) {
        const allFiles = await this.getAllDatabaseFiles();
        const files = targetFiles
            ? allFiles.filter((e) => targetFiles.some((t) => e.path.indexOf(t) !== -1))
            : allFiles;
        for (const file of files) {
            const path = stripAllPrefixes(this.getPath(file));
            await this.processedState.updateLastProcessedAsActualDatabase(path, file);
        }
    }

    private async trackScannedStorageChanges(
        processFiles: FilePath[],
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeleted = true
    ) {
        const logLevel = getLogLevel(showNotice);
        const p = this._progress(`[⚙ Storage -> DB ]\n`, logLevel);
        const notifyProgress = onlyInNTimes(100, (progress) => p.log(`${progress}/${processFiles.length}`));
        const processes = processFiles.map(async (file, i) => {
            try {
                await this.trackStorageFileModification(file, onlyNew, forceWriteAll, includeDeleted);
                notifyProgress();
            } catch (ex) {
                p.once(`Failed to process storage change file:${file}`);
                this._log(ex, LOG_LEVEL_VERBOSE);
            }
        });
        await Promise.all(processes);
        p.done();
    }
    async scanAllStorageChanges(
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeleted = true
    ) {
        return await skipIfDuplicated("scanAllStorageChanges", async () => {
            const logLevel = getLogLevel(showNotice);
            const p = this._progress(`[⚙ Scanning Storage -> DB ]\n`, logLevel);
            p.log(`Scanning storage files...`);
            const knownNames = [...this.processedState.getLastProcessedFileKeys()] as FilePath[];
            const existNames = await this.scanInternalFileNames();
            const files = new Set([...knownNames, ...existNames]);

            this._log(
                `Known/Exist ${knownNames.length}/${existNames.length}, Totally ${files.size} files.`,
                LOG_LEVEL_VERBOSE
            );
            const taskNameAndMeta = [...files].map(async (e) => [e, await this.storageAccess.statHidden(e)] as const);
            const nameAndMeta = await Promise.all(taskNameAndMeta);
            const processFiles = nameAndMeta
                .filter(([path, stat]) => {
                    if (forceWriteAll) return true;
                    const key = this.processedState.getLastProcessedFileKey(path);
                    const newKey = this.processedState.storageStateKey(stat);
                    return key != newKey;
                })
                .map(([path, stat]) => path);

            const staticsMessage = `[Storage hidden file statics]
Known files: ${knownNames.length}
Actual files: ${existNames.length}
All files: ${files.size}
Offline Changed files: ${processFiles.length}`;
            // this._log(staticsMessage, logLevel, "scan-changes");
            p.once(staticsMessage);
            await this.trackScannedStorageChanges(processFiles, showNotice, onlyNew, forceWriteAll, includeDeleted);
            p.done();
        });
    }

    /**
     * check the file is changed or not, and if changed, process it.
     */
    private async trackStorageFileModification(
        path: FilePath,
        onlyNew = false,
        forceWrite = false,
        includeDeleted = true
    ): Promise<boolean | undefined> {
        if (!(await this.pathAdmission.isTargetFile(path))) {
            this._log(
                `Storage file tracking: Hidden file skipped: ${path} is filtered out by the defined patterns.`,
                LOG_LEVEL_VERBOSE
            );
            return false;
        }
        return await this.changeProcessor.processStorageChange(path, onlyNew, forceWrite, includeDeleted);
    }

    // --> Event Source Handler (Database)
    private async processReplicationResult(doc: LoadedEntry): Promise<boolean> {
        const info = describeHiddenFileSyncDocument(doc, this.getPath(doc));
        const path = info.path;
        const headerLine = `Tracking DB ${info.path} (${info.revDisplay}) :`;
        const ret = await this.trackDatabaseFileModification(path, headerLine);
        this._log(`${headerLine} Done: ${info.shortenedId})`, LOG_LEVEL_VERBOSE);
        return ret;
    }

    // <-- Event Source Handler (Database)

    // --> Database Event Functions

    private async trackScannedDatabaseChange(
        processFiles: MetaEntry[],
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeletion = true
    ) {
        const logLevel = getLogLevel(showNotice);
        const p = this._progress(`[⚙ DB -> Storage ]\n`, logLevel);
        const notifyProgress = onlyInNTimes(100, (progress) => p.log(`${progress}/${processFiles.length}`));
        const processes = processFiles.map(async (file) => {
            try {
                const path = stripAllPrefixes(this.getPath(file));
                if (!(await this.pathAdmission.isTargetFile(path))) {
                    this._log(
                        `Database file tracking: Hidden file skipped: ${path} is filtered out by the defined patterns.`,
                        LOG_LEVEL_VERBOSE
                    );
                } else {
                    await this.trackDatabaseFileModification(
                        path,
                        "[Hidden file scan]",
                        !forceWriteAll,
                        onlyNew,
                        file,
                        includeDeletion
                    );
                }
                notifyProgress();
            } catch (ex) {
                this._log(`Failed to process storage change file:${tryGetFilePath(file)}`, logLevel);
                this._log(ex, LOG_LEVEL_VERBOSE);
            }
        });
        await Promise.all(processes);
        p.done();
    }

    async applyOfflineChanges(showNotice: boolean) {
        const logLevel = getLogLevel(showNotice);
        return await serialized("applyOfflineChanges", async () => {
            const p = this._progress("[⚙ Apply untracked changes ]\n", logLevel);
            this._log(`Track changes.`, logLevel);
            p.log("Enumerating local files...");
            const currentStorageFiles = await this.scanInternalFileNames();
            p.log("Enumerating database files...");
            const currentDatabaseFiles = await this.getAllDatabaseFiles();
            const allDatabaseMap = Object.fromEntries(
                currentDatabaseFiles.map((e) => [stripAllPrefixes(this.getPath(e)), e])
            );
            const currentDatabaseFileNames = [...Object.keys(allDatabaseMap)] as FilePath[];
            const untrackedLocal = currentStorageFiles.filter((e) => !this.processedState.hasLastProcessedFile(e));
            const untrackedDatabase = currentDatabaseFileNames.filter(
                (e) => !this.processedState.hasLastProcessedDatabase(e)
            );
            const bothUntracked = untrackedLocal.filter((e) => untrackedDatabase.indexOf(e) !== -1);
            p.log("Applying untracked changes...");
            const stat = `Tracking statics:
Local files: ${currentStorageFiles.length}
Database files: ${currentDatabaseFileNames.length}
Untracked local files: ${untrackedLocal.length}
Untracked database files: ${untrackedDatabase.length}
Common untracked files: ${bothUntracked.length}`;
            p.once(stat);
            const semaphores = Semaphore(10);
            const notifyProgress = onlyInNTimes(25, (progress) => p.log(`${progress}/${bothUntracked.length}`));
            const allProcesses = bothUntracked.map(async (file) => {
                notifyProgress();
                const rel = await semaphores.acquire();
                try {
                    const fileStat = await this.storageAccess.statHidden(file);
                    if (fileStat == null) {
                        // This should not be happened. But, if it happens, we should skip this.
                        this._log(`Unexpected error: Failed to stat file during applyOfflineChange :${file}`);
                        return;
                    }
                    const dbInfo = allDatabaseMap[file];
                    if (dbInfo.deleted || dbInfo._deleted) {
                        // Applying deletion can be harmful if the local file is not tracked.
                        // So, we should skip this.
                        return;
                    }
                    const fileMTime = getHiddenFileSyncComparisonMTime(fileStat);
                    const dbMTime = getHiddenFileSyncComparisonMTime(dbInfo);
                    const diff = compareMTime(fileMTime, dbMTime);
                    if (diff == BASE_IS_NEW) {
                        // Local file is newer than the database file.
                        // So, we should apply the local file to the database.
                        await this.trackStorageFileModification(file, true);
                    } else if (diff == TARGET_IS_NEW) {
                        // Database file is newer than the local file.
                        // So, we should apply the database file to the local file.
                        await this.trackDatabaseFileModification(file, "[Apply]", true, true, dbInfo);
                    } else if (diff == EVEN) {
                        // Both are same, we may skip this but should update the last processed key.
                        this.processedState.updateLastProcessed(file, dbInfo, fileStat);
                    }
                } finally {
                    rel();
                }
            });
            await Promise.all(allProcesses);
            await this.scanAllStorageChanges(showNotice);
            await this.scanAllDatabaseChanges(showNotice);

            p.done();
        });
    }

    async scanAllDatabaseChanges(
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeletion = true
    ) {
        return await skipIfDuplicated("scanAllDatabaseChanges", async () => {
            const databaseFiles = await this.getAllDatabaseFiles();
            const files = databaseFiles.filter((e) => {
                const doc = e;
                const key = this.processedState.databaseStateKey(doc);
                const path = stripAllPrefixes(this.getPath(doc));
                const lastKey = this.processedState.getLastProcessedDatabaseKey(path);
                return lastKey != key;
            });
            const logLevel = getLogLevel(showNotice);
            const staticsMessage = `[Database hidden file statics]
All files: ${databaseFiles.length}
Offline Changed files: ${files.length}`;
            this._log(staticsMessage, logLevel, "scan-changes");
            return await this.trackScannedDatabaseChange(files, showNotice, onlyNew, forceWriteAll, includeDeletion);
        });
    }

    private async useDatabaseFiles(files: MetaEntry[], showNotice = false, onlyNew = false) {
        const logLevel = getLogLevel(showNotice);
        const p = this._progress(`[⚙ Scanning DB -> Storage ]\n`, logLevel);
        p.log("Scanning database files...");
        const notifyProgress = onlyInNTimes(25, (progress) => p.log(`${progress}/${files.length}`));
        const processFiles = files.map(async (file) => {
            try {
                const path = stripAllPrefixes(this.getPath(file));
                await this.trackDatabaseFileModification(path, "[Scanning]", true, onlyNew, file);
                notifyProgress();
            } catch (ex) {
                this._log(`Failed to process database changes:${tryGetFilePath(file)}`);
                this._log(ex, LOG_LEVEL_VERBOSE);
            }
            return;
        });
        await Promise.all(processFiles);
        p.done();
        return true;
    }

    private async trackDatabaseFileModification(
        path: FilePath,
        headerLine: string,
        preventDoubleProcess = false,
        onlyNew = false,
        meta: MetaEntry | false = false,
        includeDeletion = true
    ): Promise<boolean> {
        return await this.changeProcessor.processDatabaseChange(path, headerLine, {
            preventDoubleProcess,
            onlyNew,
            metaEntry: meta,
            includeDeletion,
        });
    }

    private queueConflict(path: FilePathWithPrefix): Promise<boolean> {
        this.conflictResolution.queue(path);
        return Promise.resolve(true);
    }

    // <-- Database Event Functions

    // --> Initialization functions

    private async rebuildMerging(showNotice: boolean, targetFiles: FilePath[] | false = false) {
        const logLevel = getLogLevel(showNotice);
        const p = this._progress("[⚙ Rebuild by Merge ]\n", logLevel);
        this._log(`Rebuilding hidden files from the storage and the local database.`, logLevel);
        p.log("Enumerating local files...");
        const currentStorageFilesAll = await this.scanInternalFileNames();
        const currentStorageFiles = targetFiles
            ? currentStorageFilesAll.filter((e) => targetFiles.some((f) => f == e))
            : currentStorageFilesAll;
        p.log("Enumerating database files...");
        const allDatabaseFiles = await this.getAllDatabaseFiles();
        const allDatabaseMap = new Map(allDatabaseFiles.map((e) => [stripAllPrefixes(this.getPath(e)), e]));
        const currentDatabaseFiles = targetFiles
            ? allDatabaseFiles.filter((e) => targetFiles.some((f) => f == stripAllPrefixes(this.getPath(e))))
            : allDatabaseFiles;

        const allFileNames = new Set([
            ...currentStorageFiles,
            ...currentDatabaseFiles.map((e) => stripAllPrefixes(this.getPath(e))),
        ]);
        const storageToDatabase = [] as FilePath[];
        const databaseToStorage = [] as MetaEntry[];

        const eachProgress = onlyInNTimes(100, (progress) => p.log(`Checking ${progress}/${allFileNames.size}`));
        for (const file of allFileNames) {
            eachProgress();
            const storageMTime = await this.storageAccess.statHidden(file);
            const mtimeStorage = getHiddenFileSyncComparisonMTime(storageMTime);
            const dbEntry = allDatabaseMap.get(file)!;
            const mtimeDB = getHiddenFileSyncComparisonMTime(dbEntry);
            const diff = compareMTime(mtimeStorage, mtimeDB);
            if (diff == BASE_IS_NEW) {
                storageToDatabase.push(file);
            } else if (diff == TARGET_IS_NEW) {
                databaseToStorage.push(dbEntry);
            } else if (diff == EVEN) {
                // For safety, storage to database.
                storageToDatabase.push(file);
            }
        }
        p.once(
            `Storage to Database: ${storageToDatabase.length} files\n Database to Storage: ${databaseToStorage.length} files`
        );
        this.processedState.resetLastProcessedDatabase(targetFiles);
        this.processedState.resetLastProcessedFile(targetFiles);
        const processes = [
            this.trackScannedStorageChanges(storageToDatabase, showNotice, false, true),
            this.useDatabaseFiles(databaseToStorage, showNotice, false),
        ];
        p.log("Start processing...");
        await Promise.all(processes);
        p.done();
        return [...allFileNames];
    }

    private async runRebuildMerging(showNotice: boolean, targetFiles: FilePath[] | false = false) {
        return this.rebuildMergingHook
            ? await this.rebuildMergingHook(showNotice, targetFiles)
            : await this.rebuildMerging(showNotice, targetFiles);
    }

    private async rebuildFromStorage(showNotice: boolean, targetFiles: FilePath[] | false = false, onlyNew = false) {
        // reset processed file markers
        const logLevel = getLogLevel(showNotice);
        this._verbose(`Rebuilding hidden files from the storage.`);
        this._log(`Rebuilding hidden files from the storage.`, logLevel);
        const p = this._progress("[⚙ Rebuild by Storage ]\n", logLevel);
        p.log("Enumerating local files...");
        const currentFilesAll = await this.scanInternalFileNames();
        const currentFiles = targetFiles
            ? currentFilesAll.filter((e) => targetFiles.some((f) => f == e))
            : currentFilesAll;
        p.once(`Storage to Database: ${currentFiles.length} files.`);
        p.log("Start processing...");
        this.processedState.resetLastProcessedFile(targetFiles);
        await this.trackScannedStorageChanges(currentFiles, showNotice, onlyNew, true);
        p.done();
        return currentFiles;
    }

    private async getAllDatabaseFiles() {
        const allFiles = (
            await this.localDatabase.allDocsRaw({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })
        ).rows
            .filter((e) => isInternalMetadata(e.id as DocumentID))
            .map((e) => e.doc) as MetaEntry[];
        const files = [] as MetaEntry[];
        for (const file of allFiles) {
            if (await this.pathAdmission.isTargetFile(stripAllPrefixes(this.getPath(file)))) {
                files.push(file);
            }
        }
        return files;
    }

    private async rebuildFromDatabase(showNotice: boolean, targetFiles: FilePath[] | false = false, onlyNew = false) {
        const logLevel = getLogLevel(showNotice);
        this._verbose(`Rebuilding hidden files from the local database.`);
        const p = this._progress("[⚙ Rebuild by Database ]\n", logLevel);
        p.log("Enumerating database files...");
        const allFiles = await this.getAllDatabaseFiles();

        // THINKING: Should we exclude conflicted or deleted files?
        // Current implementation is to include all files, and following processes will handle for them.
        // However, in perspective of performance and future-proofing, I feel somewhat justified in doing it here.

        const currentFiles = targetFiles
            ? allFiles.filter((e) => targetFiles.some((f) => f == stripAllPrefixes(this.getPath(e))))
            : allFiles;

        p.once(`Database to Storage: ${currentFiles.length} files.`);
        this.processedState.resetLastProcessedDatabase(targetFiles);
        p.log("Start processing...");
        await this.useDatabaseFiles(currentFiles, showNotice, onlyNew);
        p.done();
        return currentFiles;
    }

    async initialiseInternalFileSync(
        direction: SyncDirection,
        showMessage: boolean,
        // filesAll: InternalFileInfo[] | false = false,
        targetFilesSrc: string[] | false = false,
        initialisationProgress?: HiddenFileSyncProgress
    ) {
        const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        const p = initialisationProgress ?? this._progress("[⚙ Initialise]\n", logLevel);
        // Compatibility question: the legacy preflight was already disabled.
        // Enabling it would change initialisation timing and could open a
        // conflict dialogue while the feature is being configured.
        // p.log("Resolving conflicts before starting...");
        // await this.conflictResolution.resolveAll();
        p.log("Initialising hidden files sync...");
        // The initialisation progress owns the user-visible Notice. Its child
        // rebuild and scan operations still write ordinary log entries, but
        // must not each create another keep-alive Notice.
        const showChildNotices = false;
        // TODO: Handling ignore files cannot be performed to the hidden files.

        const targetFiles = targetFilesSrc
            ? targetFilesSrc.map((e) => stripAllPrefixes(e as FilePathWithPrefix))
            : false;
        if (direction == "pushForce" || direction == "push") {
            const onlyNew = direction == "push";
            p.log(`Started: Storage --> Database ${onlyNew ? "(Only New)" : ""}`);
            const updatedFiles = await this.rebuildFromStorage(showChildNotices, targetFiles, onlyNew);
            // making doubly sure, No more losing files.
            // I did so many times during the development.
            await this.adoptCurrentStorageFilesAsProcessed(updatedFiles);
            await this.adoptCurrentDatabaseFilesAsProcessed(updatedFiles);
            // And, scan other changes on the database (i.e. files which are on only other devices)
            p.log("Checking for remaining storage and database changes...");
            await this.scanAllStorageChanges(showChildNotices, true, false);
            await this.scanAllDatabaseChanges(showChildNotices, true, false);
        }
        if (direction == "pullForce" || direction == "pull") {
            const onlyNew = direction == "pull";
            p.log(`Started: Database --> Storage ${onlyNew ? "(Only New)" : ""}`);
            const updatedEntries = await this.rebuildFromDatabase(showChildNotices, targetFiles, onlyNew);
            const updatedFiles = updatedEntries.map((e) => stripAllPrefixes(this.getPath(e)));
            // making doubly sure, No more losing files.
            await this.adoptCurrentStorageFilesAsProcessed(updatedFiles);
            await this.adoptCurrentDatabaseFilesAsProcessed(updatedFiles);
            // And, scan other changes on the database (i.e. files which are on only other devices)
            p.log("Checking for remaining database and storage changes...");
            await this.scanAllDatabaseChanges(showChildNotices, true, false);
            await this.scanAllStorageChanges(showChildNotices, true, false);
        }
        if (direction == "safe") {
            p.log(`Started: Database <--> Storage (by modified date)`);
            const updatedFiles = await this.runRebuildMerging(showChildNotices, targetFiles);
            await this.adoptCurrentStorageFilesAsProcessed(updatedFiles);
            await this.adoptCurrentDatabaseFilesAsProcessed(updatedFiles);
            // And, scan other changes on the database (i.e. files which are on only other devices)
            p.log("Checking for remaining storage and database changes...");
            await this.scanAllStorageChanges(showChildNotices, true, false);
            await this.scanAllDatabaseChanges(showChildNotices, true, false);
        }
        p.done();
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
        let initialisationProgress: HiddenFileSyncProgress | undefined;
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

    // --> Local Storage SubFunctions
    private async scanInternalFileNames() {
        const findRoot = this.dependencies.getRootPath();

        const filenames = await collectOptionalFileSyncFiles(this.dependencies, findRoot, {
            shouldInclude: (path) => this.pathAdmission.isTargetFile(path as FilePath),
            onError: (path, error) => {
                this._log(`Could not traverse(HiddenSync):${path}`, LOG_LEVEL_INFO);
                this._log(error, LOG_LEVEL_VERBOSE);
            },
        });

        return filenames as FilePath[];
    }

    private async scanInternalFiles(): Promise<InternalFileInfo[]> {
        const fileNames = await this.scanInternalFileNames();
        const files = fileNames.map(async (e) => {
            return {
                path: e,
                stat: await this.storageAccess.statHidden(e),
            };
        });
        const result: InternalFileInfo[] = [];
        for (const f of files) {
            const w = await f;
            if (await this.dependencies.isIgnoredByIgnoreFile(w.path)) {
                continue;
            }
            const mtime = w.stat?.mtime ?? 0;
            const ctime = w.stat?.ctime ?? mtime;
            const size = w.stat?.size ?? 0;
            result.push({
                ...w,
                mtime,
                ctime,
                size,
            });
        }
        return result;
    }

    // <-- Local Storage SubFunctions
}
