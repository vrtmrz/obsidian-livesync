import {
    type AnyEntry,
    type LoadedEntry,
    type FilePathWithPrefix,
    type FilePath,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type SavingEntry,
    type DocumentID,
    type UXFileInfo,
    type UXStat,
    LOG_LEVEL_DEBUG,
    type MetaEntry,
    type UXDataWriteOptions,
    type ObsidianLiveSyncSettings,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { type InternalFileInfo, ICHeader, ICHeaderEnd } from "@/common/types.ts";
import {
    readAsBlob,
    isDocContentSame,
    readContent,
    createBlob,
    type CustomRegExp,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";
import {
    compareMTime,
    isInternalMetadata,
    TARGET_IS_NEW,
    cancelTask,
    scheduleTask,
    getLogLevel,
    autosaveCache,
    type MapLike,
    onlyInNTimes,
    BASE_IS_NEW,
    EVEN,
    displayRev,
} from "@/common/utils.ts";
import { serialized, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { addPrefix, stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { tryGetFilePath } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import { configureHiddenFileSyncMode, type ConfigureHiddenFileSyncResult } from "./configureHiddenFileSyncMode.ts";
import type { OptionalSyncFeatureMode } from "@/features/optionalSyncFeatures.ts";
import { $msg } from "@/common/translation";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type { KeyValueDatabase } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { HiddenFileSyncCommandView, HiddenFileSyncRepairView } from "./hiddenFileSyncViews.ts";
type SyncDirection = "push" | "pull" | "safe" | "pullForce" | "pushForce";

export type HiddenFileSyncProgress = {
    log(message: string): void;
    once(message: string): void;
    done(message?: string): void;
};

const HIDDEN_FILE_NOTIFICATION_TASK = "notify-config-change";

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

type HiddenFileSyncStorage = Pick<
    StorageAccess,
    | "ensureDir"
    | "isExistsIncludeHidden"
    | "readHiddenFileAuto"
    | "removeHidden"
    | "statHidden"
    | "triggerHiddenFile"
    | "writeHiddenFileAuto"
>;

type HiddenFileSyncDatabaseFileAccess = Pick<
    DatabaseFileAccess,
    "fetchEntryFromMeta" | "fetchEntryMeta" | "getConflictedRevs" | "storeWithBaseRevision"
>;

export type HiddenFileSyncPeriodicProcessor = {
    enable(interval: number): void;
    disable(): void;
};

export type HiddenFileSyncJsonResolution = {
    keepRevision?: string;
    mergedText?: string;
};

export type HiddenFileSyncDirectoryListing = {
    files: string[];
    folders: string[];
};

export type HiddenFileSyncContextDependencies = {
    getSettings(): HiddenFileSyncSettings;
    getLocalDatabase(): HiddenFileSyncDatabase;
    getKeyValueDatabase(): KeyValueDatabase;
    storageAccess: HiddenFileSyncStorage;
    databaseFileAccess: HiddenFileSyncDatabaseFileAccess;
    path: Pick<IPathService, "getPath" | "markChangesAreSame" | "path2id" | "unmarkChanges">;
    log: LogFunction;
    createProgress(prefix?: string, level?: LOG_LEVEL): HiddenFileSyncProgress;
    createPeriodicProcessor(process: () => Promise<unknown>): HiddenFileSyncPeriodicProcessor;
    isReady(): boolean;
    isSuspended(): boolean;
    isDatabaseReady(): boolean;
    isIgnoredByIgnoreFile(path: string): Promise<boolean>;
    getConfigDir(): string;
    getRootPath(): string;
    listFiles(path: string): Promise<HiddenFileSyncDirectoryListing>;
    getFileRegExp(
        key: "syncInternalFileOverwritePatterns" | "syncInternalFilesIgnorePatterns" | "syncInternalFilesTargetPatterns"
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

function getComparingMTime(
    doc: (MetaEntry | LoadedEntry | false) | UXFileInfo | UXStat | null | undefined,
    includeDeleted = false
) {
    if (doc === null) return 0;
    if (doc === false) return 0;
    if (doc === undefined) return 0;
    if (!includeDeleted) {
        if ("deleted" in doc && doc.deleted) return 0;
        if ("_deleted" in doc && doc._deleted) return 0;
    }
    if ("stat" in doc) return doc.stat?.mtime ?? 0;
    return doc.mtime ?? 0;
}

export class HiddenFileSyncContext implements HiddenFileSyncCommandView, HiddenFileSyncRepairView {
    private readonly dependencies: HiddenFileSyncContextDependencies;
    readonly periodicInternalFileScanProcessor: HiddenFileSyncPeriodicProcessor;
    private eventCount = 0;
    private processingCount = 0;
    private disposed = false;

    constructor(dependencies: HiddenFileSyncContextDependencies) {
        this.dependencies = dependencies;
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

    private get kvDB() {
        return this.dependencies.getKeyValueDatabase();
    }

    private async path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        return await this.dependencies.path.path2id(filename, prefix);
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

    isThisModuleEnabled() {
        return this.settings.syncInternalFiles;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.periodicInternalFileScanProcessor?.disable();
        this.conflictResolutionProcessor?.terminate();
        this.pendingConflictChecks.clear();
        this.queuedNotificationFiles.clear();
        this.cacheFileRegExps.clear();
        cancelTask(HIDDEN_FILE_NOTIFICATION_TASK);
        this.eventCount = 0;
        this.processingCount = 0;
        this.dependencies.publishActivity(0, 0);
        this.dependencies.closeJsonConflictDialogs();
        this.dependencies.hideConfigurationChangeNotice();
    }

    // The key-value database becomes available before this lifecycle callback.
    async _everyOnDatabaseInitialized(showNotice: boolean) {
        this._fileInfoLastProcessed = await autosaveCache(this.kvDB, "hidden-file-lastProcessed");
        this._databaseInfoLastProcessed = await autosaveCache(this.kvDB, "hidden-file-lastProcessed-database");
        this._fileInfoLastKnown = await autosaveCache(this.kvDB, "hidden-file-lastKnown");
        if (this.isThisModuleEnabled()) {
            if (this._fileInfoLastProcessed.size == 0) {
                this._log(`No cache found. Performing startup scan.`, LOG_LEVEL_VERBOSE);
                await this.performStartupScan(true);
            } else {
                await this.performStartupScan(showNotice);
            }
        }
        return true;
    }
    async _everyBeforeReplicate(showNotice: boolean) {
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

    _everyOnloadAfterLoadSettings(): Promise<boolean> {
        this.updateSettingCache();
        return Promise.resolve(true);
    }

    updateSettingCache() {
        this.cacheFileRegExps.clear();
    }

    isReady() {
        if (this.disposed) return false;
        if (!this._isMainReady()) return false;
        if (this._isMainSuspended()) return false;
        if (!this.isThisModuleEnabled()) return false;
        return true;
    }

    isManualCommandAvailable() {
        return this.settings.useAdvancedMode && this.isReady() && this._isDatabaseReady();
    }

    async performStartupScan(showNotice: boolean) {
        await this.applyOfflineChanges(showNotice);
    }

    async _everyOnResumeProcess(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return true;
        if (this.isThisModuleEnabled()) {
            await this.performStartupScan(false);
        }
        this.periodicInternalFileScanProcessor.enable(
            this.isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        return true;
    }

    _everyRealizeSettingSyncMode(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return Promise.resolve(true);
        if (!this._isMainReady()) return Promise.resolve(true);
        this.periodicInternalFileScanProcessor.enable(
            this.isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        this.cacheFileRegExps.clear();
        return Promise.resolve(true);
    }

    async _anyProcessOptionalFileEvent(path: FilePath): Promise<boolean> {
        if (this.isReady()) {
            return (await this.trackStorageFileModification(path)) || false;
        }
        return false;
    }

    _anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | "newer"> {
        if (isInternalMetadata(path)) {
            this.queueConflictCheck(path);
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    async _anyProcessOptionalSyncFiles(doc: LoadedEntry): Promise<boolean> {
        if (isInternalMetadata(doc._id)) {
            if (this.isThisModuleEnabled()) {
                //system file
                const filename = this.getPath(doc);
                const unprefixedPath = stripAllPrefixes(filename);
                if (!(await this.isTargetFile(stripAllPrefixes(unprefixedPath)))) {
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

    async loadFileWithInfo(path: FilePath): Promise<UXFileInfo> {
        const stat = await this.storageAccess.statHidden(path);
        if (!stat)
            return {
                name: path.split("/").pop() ?? "",
                path,
                stat: {
                    size: 0,
                    mtime: 0,
                    ctime: 0,
                    type: "file",
                },
                isInternal: true,
                deleted: true,
                body: createBlob(new Uint8Array(0)),
            };
        const content = await this.storageAccess.readHiddenFileAuto(path);
        return {
            name: path.split("/").pop() ?? "",
            path,
            stat,
            isInternal: true,
            deleted: false,
            body: createBlob(content),
        };
    }

    _fileInfoLastProcessed!: MapLike<string, string>;
    _fileInfoLastKnown!: MapLike<string, number>;
    _databaseInfoLastProcessed!: MapLike<string, string>;

    statToKey(stat: UXStat | null) {
        return `${stat?.mtime ?? 0}-${stat?.size ?? 0}`;
    }
    docToKey(doc: LoadedEntry | MetaEntry) {
        return `${doc.mtime}-${doc.size}-${doc._rev}-${doc._deleted || doc.deleted || false ? "-0" : "-1"}`;
    }
    async fileToStatKey(file: FilePath, stat: UXStat | null = null) {
        if (!stat) stat = await this.storageAccess.statHidden(file);
        return this.statToKey(stat);
    }

    updateLastProcessedFile(file: FilePath, keySrc: string | UXStat) {
        const key = typeof keySrc == "string" ? keySrc : this.statToKey(keySrc);
        const splitted = key.split("-");
        if (splitted[0] != "0") {
            this._fileInfoLastKnown.set(file, Number(splitted[0]));
        }
        this._fileInfoLastProcessed.set(file, key);
    }

    async updateLastProcessedAsActualFile(file: FilePath, stat?: UXStat | null) {
        if (!stat) stat = await this.storageAccess.statHidden(file);
        this._fileInfoLastProcessed.set(file, this.statToKey(stat));
    }

    resetLastProcessedFile(targetFiles: FilePath[] | false) {
        if (targetFiles) {
            for (const key of targetFiles) {
                this._fileInfoLastProcessed.delete(key);
            }
        } else {
            this._log(`Delete all processed mark.`, LOG_LEVEL_VERBOSE);
            // THINKING: Should we...
            // - delete all `Known file` processed mark? (This is current implementation)
            // - delete all `Existing file` processed mark?
            // - delete all files inside the config folder of current device mark?
            this._fileInfoLastProcessed.clear();
        }
    }

    getLastProcessedFileMTime(file: FilePath) {
        const key = this._fileInfoLastKnown.get(file);
        if (!key) return 0;
        return key;
    }

    getLastProcessedFileKey(file: FilePath) {
        return this._fileInfoLastProcessed.get(file);
    }

    getLastProcessedDatabaseKey(file: FilePath) {
        return this._databaseInfoLastProcessed.get(file);
    }
    updateLastProcessedDatabase(file: FilePath, keySrc: string | MetaEntry | LoadedEntry) {
        const key = typeof keySrc == "string" ? keySrc : this.docToKey(keySrc);
        this._databaseInfoLastProcessed.set(file, key);
    }
    updateLastProcessed(path: FilePath, db: MetaEntry | LoadedEntry, stat: UXStat) {
        this.updateLastProcessedDatabase(path, db);
        this.updateLastProcessedFile(path, this.statToKey(stat));
        const dbMTime = getComparingMTime(db);
        const storageMTime = getComparingMTime(stat);
        if (dbMTime == 0 || storageMTime == 0) {
            this.dependencies.path.unmarkChanges(path);
        } else {
            this.dependencies.path.markChangesAreSame(path, getComparingMTime(db), getComparingMTime(stat));
        }
    }
    updateLastProcessedDeletion(path: FilePath, db: MetaEntry | LoadedEntry | false) {
        this.dependencies.path.unmarkChanges(path);
        if (db) this.updateLastProcessedDatabase(path, db);
        this.updateLastProcessedFile(path, this.statToKey(null));
    }
    async ensureDir(path: FilePath) {
        const isExists = await this.storageAccess.isExistsIncludeHidden(path);
        if (!isExists) {
            await this.storageAccess.ensureDir(path);
        }
    }

    async writeFile(path: FilePath, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<UXStat | null> {
        await this.storageAccess.writeHiddenFileAuto(path, data, opt);
        const stat = await this.storageAccess.statHidden(path);
        // this.updateLastProcessedFile(path, this.statToKey(stat));
        return stat;
    }

    async __removeFile(path: FilePath): Promise<"OK" | "ALREADY" | false> {
        try {
            if (!(await this.storageAccess.isExistsIncludeHidden(path))) {
                // Already deleted
                // this.updateLastProcessedFile(path, this.statToKey(null));
                return "ALREADY";
            }
            if (await this.storageAccess.removeHidden(path)) {
                // this.updateLastProcessedFile(path, this.statToKey(null));
                return "OK";
            }
        } catch (ex) {
            this._log(`Failed to remove file:${path}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        return false;
    }
    async triggerEvent(path: FilePath) {
        try {
            await this.storageAccess.triggerHiddenFile(path);
        } catch (ex) {
            this._log("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
    }

    async updateLastProcessedAsActualDatabase(file: FilePath, doc?: MetaEntry | LoadedEntry | null | false) {
        const dbPath = addPrefix(file, ICHeader);
        if (!doc) doc = await this.localDatabase.getDBEntryMeta(dbPath);
        if (!doc) return;
        this._databaseInfoLastProcessed.set(file, this.docToKey(doc));
    }

    resetLastProcessedDatabase(targetFiles: FilePath[] | false) {
        if (targetFiles) {
            for (const key of targetFiles) {
                this._databaseInfoLastProcessed.delete(key);
            }
        } else {
            this._log(`Delete all processed mark.`, LOG_LEVEL_VERBOSE);
            // THINKING: Should we...
            // - delete all `Known file` processed mark? (This is current implementation)
            // - delete all `Existing file` processed mark?
            // - delete all files inside the config folder of current device mark?
            this._databaseInfoLastProcessed.clear();
        }
    }

    async adoptCurrentStorageFilesAsProcessed(targetFiles: FilePath[] | false) {
        const allFiles = await this.scanInternalFileNames();
        const files = targetFiles ? allFiles.filter((e) => targetFiles.some((t) => e.indexOf(t) !== -1)) : allFiles;
        for (const file of files) {
            await this.updateLastProcessedAsActualFile(file);
        }
    }
    async adoptCurrentDatabaseFilesAsProcessed(targetFiles: FilePath[] | false) {
        const allFiles = await this.getAllDatabaseFiles();
        const files = targetFiles
            ? allFiles.filter((e) => targetFiles.some((t) => e.path.indexOf(t) !== -1))
            : allFiles;
        for (const file of files) {
            const path = stripAllPrefixes(this.getPath(file));
            await this.updateLastProcessedAsActualDatabase(path, file);
        }
    }

    semaphore = Semaphore(10);
    async serializedForEvent<T>(file: FilePath, fn: () => Promise<T>) {
        this.eventCount++;
        this.publishActivity();
        const rel = await this.semaphore.acquire();
        try {
            return await serialized(`hidden-file-event:${file}`, async () => {
                this.processingCount++;
                this.publishActivity();
                try {
                    return await fn();
                } finally {
                    this.processingCount = Math.max(0, this.processingCount - 1);
                    this.publishActivity();
                }
            });
        } finally {
            rel();
            this.eventCount = Math.max(0, this.eventCount - 1);
            this.publishActivity();
        }
    }

    private publishActivity() {
        this.dependencies.publishActivity(
            this.disposed ? 0 : this.eventCount,
            this.disposed ? 0 : this.processingCount
        );
    }

    async useStorageFiles(files: FilePath[], showNotice = false, onlyNew = false) {
        return await this.trackScannedStorageChanges(files, showNotice, onlyNew, true);
    }

    async trackScannedStorageChanges(
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
            const knownNames = [...this._fileInfoLastProcessed.keys()] as FilePath[];
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
                    const key = this.getLastProcessedFileKey(path);
                    const newKey = this.statToKey(stat);
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
    async trackStorageFileModification(
        path: FilePath,
        onlyNew = false,
        forceWrite = false,
        includeDeleted = true
    ): Promise<boolean | undefined> {
        if (!(await this.isTargetFile(path))) {
            this._log(
                `Storage file tracking: Hidden file skipped: ${path} is filtered out by the defined patterns.`,
                LOG_LEVEL_VERBOSE
            );
            return false;
        }
        try {
            return await this.serializedForEvent(path, async () => {
                let stat = await this.storageAccess.statHidden(path);
                // sometimes folder is coming.
                if (stat != null && stat.type != "file") {
                    return false;
                }
                const key = await this.fileToStatKey(path, stat);
                // At here, we need to check to not to respond the same event.
                // (a raw event occurs even at the file reading).
                // This is only for the events. Not for scanning. Because of the scan is for not to miss any changes.
                // Mostly all of before scanning, we should processed the files at the event.
                const lastKey = this.getLastProcessedFileKey(path);
                if (lastKey == key) {
                    this._log(`${path} Already processed.`, LOG_LEVEL_DEBUG);
                    return true;
                }
                // We should cache the file
                const cache = await this.loadFileWithInfo(path);
                const cacheMTime = getComparingMTime(cache.stat);
                const statMtime = getComparingMTime(stat);
                if (cacheMTime != statMtime) {
                    this._log(`Hidden file:${path} is changed.`, LOG_LEVEL_VERBOSE);
                    stat = cache.stat;
                }
                this.updateLastProcessedFile(path, stat!);
                const lastIsNotFound = !lastKey || lastKey.endsWith("-0-0");
                const nowIsNotFound = cache.deleted;
                const type = lastIsNotFound && nowIsNotFound ? "invalid" : nowIsNotFound ? "delete" : "modified";

                if (type == "invalid") {
                    // Maybe the folder is deleted.
                    return false;
                }

                const storageMTimeActual = getComparingMTime(stat);
                const storageMTime =
                    storageMTimeActual == 0 ? this.getLastProcessedFileMTime(path) : storageMTimeActual;

                if (onlyNew) {
                    // If the file is deleted, and it was not new, we should process it.
                    const prefixedFileName = addPrefix(path, ICHeader);
                    const filesOnDB = await this.localDatabase.getDBEntryMeta(prefixedFileName);
                    const dbMTime = getComparingMTime(filesOnDB, includeDeleted);
                    const diff = compareMTime(storageMTime, dbMTime);

                    if (diff != TARGET_IS_NEW) {
                        this._log(`Hidden file:${path} is not new.`, LOG_LEVEL_VERBOSE);
                        if (filesOnDB && stat) {
                            // OnlyNew not handles the deletion.
                            this.updateLastProcessed(path, filesOnDB, stat);
                        }
                        return true;
                    }
                }

                if (type == "delete") {
                    this._log(`Deletion detected: ${path}`);
                    const result = await this.deleteInternalFileOnDatabase(path, forceWrite);
                    return result;
                } else if (type == "modified") {
                    this._log(`Modification detected:${path}`, LOG_LEVEL_VERBOSE);
                    const result = await this.storeInternalFileToDatabase(cache, forceWrite);
                    const resultText = result === undefined ? "Nothing changed" : result ? "Updated" : "Failed";
                    this._log(`${resultText}: ${path} ${resultText}`, LOG_LEVEL_VERBOSE);
                    return result;
                }
            });
        } catch (ex) {
            this._log(`Failed to process hidden file:${path}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        // Could not be processed. but it was own task. so return true to prevent further processing.
        return true;
    }

    // --> Conflict processing

    // Keep one in-flight conflict check per path so repeated sync events do not close the active merge dialogue.
    pendingConflictChecks = new Set<FilePathWithPrefix>();

    queueConflictCheck(path: FilePathWithPrefix) {
        if (this.disposed) return;
        if (this.pendingConflictChecks.has(path)) return;
        this.pendingConflictChecks.add(path);
        this.conflictResolutionProcessor.enqueue(path);
    }

    finishConflictCheck(path: FilePathWithPrefix) {
        this.pendingConflictChecks.delete(path);
    }

    requeueConflictCheck(path: FilePathWithPrefix) {
        this.finishConflictCheck(path);
        this.queueConflictCheck(path);
    }

    async resolveConflictOnInternalFiles() {
        // Scan all conflicted internal files
        const conflicted = this.localDatabase.findEntries(ICHeader, ICHeaderEnd, { conflicts: true });
        this.conflictResolutionProcessor.suspend();
        try {
            for await (const doc of conflicted) {
                if (!("_conflicts" in doc)) continue;
                if (isInternalMetadata(doc._id)) {
                    this.queueConflictCheck(doc.path);
                }
            }
        } catch (ex) {
            this._log("something went wrong on resolving all conflicted internal files");
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        await this.conflictResolutionProcessor.startPipeline().waitForAllProcessed();
    }

    async resolveByNewerEntry(
        id: DocumentID,
        path: FilePathWithPrefix,
        currentDoc: MetaEntry,
        currentRev: string,
        conflictedRev: string
    ) {
        const conflictedDoc = await this.localDatabase.getRaw<MetaEntry>(id, { rev: conflictedRev });
        // determine which revision should been deleted.
        // simply check modified time
        const mtimeCurrent = getComparingMTime(currentDoc, true);
        const mtimeConflicted = getComparingMTime(conflictedDoc, true);
        // this._log(`Revisions:${new Date(mtimeA).toLocaleString} and ${new Date(mtimeB).toLocaleString}`);
        // console.log(`mtime:${mtimeA} - ${mtimeB}`);
        const delRev = mtimeCurrent < mtimeConflicted ? currentRev : conflictedRev;
        // delete older one.
        await this.localDatabase.removeRevision(id, delRev);
        this._log(`Older one has been deleted:${path}`);
        const cc = await this.localDatabase.getRaw(id, { conflicts: true });
        if (cc._conflicts?.length === 0) {
            await this.extractInternalFileFromDatabase(stripAllPrefixes(path));
            this.finishConflictCheck(path);
        } else {
            this.requeueConflictCheck(path);
        }
        // check the file again
    }
    conflictResolutionProcessor = new QueueProcessor(
        async (paths: FilePathWithPrefix[]) => {
            const path = paths[0];
            try {
                // Retrieve data
                const id = await this.path2id(path, ICHeader);
                const doc = await this.localDatabase.getRaw<MetaEntry>(id, { conflicts: true });
                if (doc._conflicts === undefined) {
                    this.finishConflictCheck(path);
                    return [];
                }
                if (doc._conflicts.length == 0) {
                    this.finishConflictCheck(path);
                    return [];
                }
                this._log(`Hidden file conflicted:${path}`);
                const conflicts = doc._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
                const revA = doc._rev;
                const revB = conflicts[0];

                if (path.endsWith(".json")) {
                    const conflictedRev = conflicts[0];
                    const conflictedRevNo = Number(conflictedRev.split("-")[0]);
                    //Search
                    const revFrom = await this.localDatabase.getRaw<MetaEntry>(id, { revs_info: true });
                    const commonBase =
                        revFrom._revs_info
                            ?.filter((e) => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo)
                            .first()?.rev ?? "";
                    const result = await this.localDatabase.managers.conflictManager.mergeObject(
                        doc.path,
                        commonBase,
                        doc._rev,
                        conflictedRev
                    );
                    if (result) {
                        this._log(`Object merge:${path}`, LOG_LEVEL_INFO);
                        const filename = stripAllPrefixes(path);
                        await this.ensureDir(filename);
                        const stat = await this.writeFile(filename, result);
                        if (!stat) {
                            throw new Error(`conflictResolutionProcessor: Failed to stat file ${filename}`);
                        }
                        await this.storeInternalFileToDatabase({ path: filename, ...stat });
                        await this.extractInternalFileFromDatabase(filename);
                        await this.localDatabase.removeRevision(id, revB);
                        this.requeueConflictCheck(path);
                        return [];
                    } else {
                        this._log(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                    }
                    // const pat = this.settings.syncInternalFileOverwritePatterns;
                    const regExp = this.dependencies.getFileRegExp("syncInternalFileOverwritePatterns");
                    if (regExp.some((r) => r.test(stripAllPrefixes(path)))) {
                        this._log(`Overwrite rule applied for conflicted hidden file: ${path}`, LOG_LEVEL_INFO);
                        await this.resolveByNewerEntry(id, path, doc, revA, revB);
                        return [];
                    }
                    return [{ path, revA, revB, id, doc }];
                }
                // When not JSON file, resolve conflicts by choosing a newer one.
                await this.resolveByNewerEntry(id, path, doc, revA, revB);
                return [];
            } catch (ex) {
                this.finishConflictCheck(path);
                this._log(`Failed to resolve conflict (Hidden): ${path}`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return [];
            }
        },
        {
            suspended: false,
            batchSize: 1,
            concurrentLimit: 5,
            delay: 10,
            keepResultUntilDownstreamConnected: true,
            yieldThreshold: 10,
            pipeTo: new QueueProcessor(
                async (results) => {
                    const { id, doc, path, revA, revB } = results[0];
                    const prefixedPath = addPrefix(path, ICHeader);
                    const docAMerge = await this.localDatabase.getDBEntry(prefixedPath, { rev: revA });
                    const docBMerge = await this.localDatabase.getDBEntry(prefixedPath, { rev: revB });
                    try {
                        if (docAMerge != false && docBMerge != false) {
                            if (await this.showJSONMergeDialogAndMerge(docAMerge, docBMerge)) {
                                // Again for other conflicted revisions.
                                this.requeueConflictCheck(path);
                            } else {
                                this.finishConflictCheck(path);
                            }
                            return;
                        } else {
                            // If either revision could not read, force resolving by the newer one.
                            await this.resolveByNewerEntry(id, path, doc, revA, revB);
                        }
                    } catch (ex) {
                        this.finishConflictCheck(path);
                        throw ex;
                    }
                },
                {
                    suspended: false,
                    batchSize: 1,
                    concurrentLimit: 1,
                    delay: 10,
                    keepResultUntilDownstreamConnected: false,
                    yieldThreshold: 10,
                }
            ),
        }
    );

    async showJSONMergeDialogAndMerge(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean> {
        this._log("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
        const docs: [LoadedEntry, LoadedEntry] = [docA, docB];
        const storageFilePath = stripAllPrefixes(docA.path);
        const displayFilename = `${storageFilePath}`;
        return await this.dependencies.resolveJsonConflict(
            storageFilePath,
            docs,
            async ({ keepRevision: keep, mergedText: result }) => {
                try {
                    let needFlush = false;
                    if (!result && !keep) {
                        this._log(`Skipped merging: ${displayFilename}`);
                        return false;
                    }
                    for (const doc of docs) {
                        if (doc._rev != keep) {
                            if (await this.localDatabase.deleteDBEntry(this.getPath(doc), { rev: doc._rev })) {
                                this._log(`Conflicted revision has been deleted: ${displayFilename}`);
                                needFlush = true;
                            }
                        }
                    }
                    if (!keep && result) {
                        await this.ensureDir(storageFilePath);
                        const stat = await this.writeFile(storageFilePath, result);
                        if (!stat) {
                            throw new Error("Stat failed");
                        }
                        const mtime = getComparingMTime(stat);
                        await this.storeInternalFileToDatabase(
                            { path: storageFilePath, mtime, ctime: stat.ctime ?? mtime, size: stat.size ?? 0 },
                            true
                        );
                        await this.triggerEvent(storageFilePath);
                        this._log(`STORAGE <-- DB:${displayFilename}: written (hidden,merged)`);
                    }
                    if (needFlush) {
                        if (await this.extractInternalFileFromDatabase(storageFilePath, false)) {
                            this._log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged)`);
                        } else {
                            this._log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged) Failed`);
                        }
                    }
                    return true;
                } catch (ex) {
                    this._log("Could not merge conflicted json");
                    this._log(ex, LOG_LEVEL_VERBOSE);
                    return false;
                }
            }
        );
    }
    // <-- Conflict processing

    // --> Event Source Handler (Database)
    getDocProps(doc: LoadedEntry) {
        /*
            type DocumentProps = {
                id: DocumentID;
                rev?: string;
                prefixedPath: FilePathWithPrefix;
                path: FilePath;
                isDeleted: boolean;
                revDisplay: string;
                shortenedId: string;
                shortenedPath: string;
            };
        */
        const id = doc._id;
        const shortenedId = id.substring(0, 10);
        const prefixedPath = this.getPath(doc);
        const path = stripAllPrefixes(prefixedPath);
        const rev = doc._rev;
        const revDisplay = rev ? displayRev(rev) : "0-NOREVS";
        // const prefix = prefixedPath.substring(0, prefixedPath.length - path.length);
        const shortenedPath = path.substring(0, 10);
        const isDeleted = doc._deleted || doc.deleted || false;
        return { id, rev, revDisplay, prefixedPath, path, isDeleted, shortenedId, shortenedPath };
    }
    async processReplicationResult(doc: LoadedEntry): Promise<boolean> {
        const info = this.getDocProps(doc);
        const path = info.path;
        const headerLine = `Tracking DB ${info.path} (${info.revDisplay}) :`;
        const ret = await this.trackDatabaseFileModification(path, headerLine);
        this._log(`${headerLine} Done: ${info.shortenedId})`, LOG_LEVEL_VERBOSE);
        return ret;
    }

    // <-- Event Source Handler (Database)

    // --> Database Event Functions

    cacheFileRegExps = new Map<string, CustomRegExp[][]>();
    /**
     * Parses the regular expression settings for hidden file synchronization.
     * @returns An object containing the ignore and target filters.
     */
    parseRegExpSettings() {
        const regExpKey = `${this.settings.syncInternalFilesTargetPatterns}||${this.settings.syncInternalFilesIgnorePatterns}`;
        let ignoreFilter: CustomRegExp[];
        let targetFilter: CustomRegExp[];
        if (this.cacheFileRegExps.has(regExpKey)) {
            const cached = this.cacheFileRegExps.get(regExpKey)!;
            ignoreFilter = cached[1];
            targetFilter = cached[0];
        } else {
            ignoreFilter = this.dependencies.getFileRegExp("syncInternalFilesIgnorePatterns");
            targetFilter = this.dependencies.getFileRegExp("syncInternalFilesTargetPatterns");
            this.cacheFileRegExps.clear();
            this.cacheFileRegExps.set(regExpKey, [targetFilter, ignoreFilter]);
        }
        return { ignoreFilter, targetFilter };
    }

    /**
     * Checks if the target file path matches the defined patterns.
     */
    isTargetFileInPatterns(path: string): boolean {
        const { ignoreFilter, targetFilter } = this.parseRegExpSettings();

        if (ignoreFilter && ignoreFilter.length > 0) {
            for (const pattern of ignoreFilter) {
                if (pattern.test(path)) {
                    return false;
                }
            }
        }
        if (targetFilter && targetFilter.length > 0) {
            for (const pattern of targetFilter) {
                if (pattern.test(path)) {
                    return true;
                }
            }
            // While having target patterns, it effects as an allow-list.
            return false;
        }
        return true;
    }

    isHiddenFileSyncHandlingPath(path: FilePath): boolean {
        const result = path.startsWith(".") && !path.startsWith(".trash");
        // console.warn(`Assertion: isHiddenFileSyncHandlingPath(${path}) = ${result}`);
        return result;
    }

    async isTargetFileEligible(path: FilePath): Promise<boolean> {
        const result = this.isTargetFileInPatterns(path) && this.isHiddenFileSyncHandlingPath(path);
        // console.warn(`Assertion: isTargetFile(${path}) : ${result ? "✔️" : "❌"}`);
        if (!result) {
            return false;
        }
        const resultByFile = await this.dependencies.isIgnoredByIgnoreFile(path);
        // console.warn(`${path}  -> isIgnoredByIgnoreFile: ${resultByFile ? "❌" : "✔️"}`);
        return !resultByFile;
    }

    async isTargetFile(path: FilePath): Promise<boolean> {
        if (this.dependencies?.ownsLocalFile(path) === false) return false;
        return await this.isTargetFileEligible(path);
    }

    async trackScannedDatabaseChange(
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
                if (!(await this.isTargetFile(path))) {
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
            const untrackedLocal = currentStorageFiles.filter((e) => !this._fileInfoLastProcessed.has(e));
            const untrackedDatabase = currentDatabaseFileNames.filter((e) => !this._databaseInfoLastProcessed.has(e));
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
                    const fileMTime = getComparingMTime(fileStat);
                    const dbMTime = getComparingMTime(dbInfo);
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
                        this.updateLastProcessed(file, dbInfo, fileStat);
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
                const key = this.docToKey(doc);
                const path = stripAllPrefixes(this.getPath(doc));
                const lastKey = this.getLastProcessedDatabaseKey(path);
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

    async useDatabaseFiles(files: MetaEntry[], showNotice = false, onlyNew = false) {
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

    async trackDatabaseFileModification(
        path: FilePath,
        headerLine: string,
        preventDoubleProcess = false,
        onlyNew = false,
        meta: MetaEntry | false = false,
        includeDeletion = true
    ): Promise<boolean> {
        return await this.serializedForEvent(path, async () => {
            try {
                // Fetch the document with conflicts
                const prefixedPath = addPrefix(path, ICHeader);
                const docMeta = meta
                    ? meta
                    : await this.localDatabase.getDBEntryMeta(prefixedPath, { conflicts: true }, true);
                if (docMeta === false) {
                    this._log(`${headerLine}: Failed to read detail of ${path}`);
                    throw new Error(`Failed to read detail ${path}`);
                }
                // Check if the file is conflicted, and if so, enqueue to resolve.
                // Until the conflict is resolved, the file will not be processed.
                if (docMeta._conflicts && docMeta._conflicts.length > 0) {
                    this.queueConflictCheck(path);
                    this._log(`${headerLine} Hidden file conflicted, enqueued to resolve`);
                    return true;
                }
                // And, extract (or delete) the file to storage.
                const extractResult = await this.extractInternalFileFromDatabase(
                    path,
                    false,
                    docMeta,
                    preventDoubleProcess,
                    onlyNew,
                    includeDeletion
                );
                if (extractResult) {
                    this._log(`${headerLine} Hidden file processed`);
                }
            } catch (ex) {
                this._log(`${headerLine} Failed to process hidden file`);
                this._log(ex, LOG_LEVEL_VERBOSE);
            }
            return true;
        });
    }

    // <-- Database Event Functions

    // --> Notification for Config Change
    queuedNotificationFiles = new Set<string>();
    notifyConfigChange() {
        const updatedFolders = [...this.queuedNotificationFiles];
        this.queuedNotificationFiles.clear();
        if (this.disposed) return;
        this.dependencies.showConfigurationChangeNotice(updatedFolders);
    }

    queueNotification(key: FilePath) {
        if (this.disposed) return;
        if (this.settings.suppressNotifyHiddenFilesChange) {
            return;
        }
        const configDir = this.dependencies.getConfigDir();
        if (!key.startsWith(configDir)) return;
        const dirName = key.split("/").slice(0, -1).join("/");
        this.queuedNotificationFiles.add(dirName);
        scheduleTask(HIDDEN_FILE_NOTIFICATION_TASK, 1000, () => {
            this.notifyConfigChange();
        });
    }
    // <-- Notification for Config Change

    // --> Initialization functions

    async rebuildMerging(showNotice: boolean, targetFiles: FilePath[] | false = false) {
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
            const mtimeStorage = getComparingMTime(storageMTime);
            const dbEntry = allDatabaseMap.get(file)!;
            const mtimeDB = getComparingMTime(dbEntry);
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
        this.resetLastProcessedDatabase(targetFiles);
        this.resetLastProcessedFile(targetFiles);
        const processes = [
            this.useStorageFiles(storageToDatabase, showNotice, false),
            this.useDatabaseFiles(databaseToStorage, showNotice, false),
        ];
        p.log("Start processing...");
        await Promise.all(processes);
        p.done();
        return [...allFileNames];
    }

    async rebuildFromStorage(showNotice: boolean, targetFiles: FilePath[] | false = false, onlyNew = false) {
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
        this.resetLastProcessedFile(targetFiles);
        await this.useStorageFiles(currentFiles, showNotice, onlyNew);
        p.done();
        return currentFiles;
    }

    async getAllDatabaseFiles() {
        const allFiles = (
            await this.localDatabase.allDocsRaw({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })
        ).rows
            .filter((e) => isInternalMetadata(e.id as DocumentID))
            .map((e) => e.doc) as MetaEntry[];
        const files = [] as MetaEntry[];
        for (const file of allFiles) {
            if (await this.isTargetFile(stripAllPrefixes(this.getPath(file)))) {
                files.push(file);
            }
        }
        return files;
    }

    async rebuildFromDatabase(showNotice: boolean, targetFiles: FilePath[] | false = false, onlyNew = false) {
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
        this.resetLastProcessedDatabase(targetFiles);
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
        // p.log("Resolving conflicts before starting...");
        // await this.resolveConflictOnInternalFiles();
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
            const updatedFiles = await this.rebuildMerging(showChildNotices, targetFiles);
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

    // --> Storage To Database Functions

    async __loadBaseSaveData(file: FilePath, includeContent = true): Promise<LoadedEntry | false> {
        const prefixedFileName = addPrefix(file, ICHeader);
        const id = await this.path2id(prefixedFileName, ICHeader);
        try {
            const old = includeContent
                ? await this.localDatabase.getDBEntry(prefixedFileName, undefined, false, true)
                : await this.localDatabase.getDBEntryMeta(prefixedFileName, { conflicts: true }, true);
            if (old === false) {
                const baseSaveData: LoadedEntry = {
                    _id: id,
                    data: [],
                    path: prefixedFileName,
                    mtime: 0,
                    ctime: 0,
                    datatype: "newnote",
                    children: [],
                    size: 0,
                    deleted: false,
                    type: "newnote",
                    eden: {},
                };
                return baseSaveData;
            } else {
                return old;
            }
        } catch (ex) {
            this._log(`Getting base save data failed`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    private async getLiveInternalRevision(
        prefixedFileName: FilePathWithPrefix,
        revision: string
    ): Promise<MetaEntry | false> {
        const [selected, current, conflicts] = await Promise.all([
            this.databaseFileAccess.fetchEntryMeta(prefixedFileName, revision, true),
            this.databaseFileAccess.fetchEntryMeta(prefixedFileName, undefined, true),
            this.databaseFileAccess.getConflictedRevs(prefixedFileName),
        ]);
        const liveRevisions = new Set([...(current && current._rev ? [current._rev] : []), ...conflicts]);
        if (!selected || selected._rev !== revision || !liveRevisions.has(revision)) {
            this._log(
                `Could not use hidden-file revision ${revision} of ${stripAllPrefixes(prefixedFileName)}; the selected revision is no longer live`,
                LOG_LEVEL_NOTICE
            );
            return false;
        }
        return selected;
    }

    async storeInternalFileToDatabase(file: InternalFileInfo | UXFileInfo, forceWrite = false) {
        const storeFilePath = stripAllPrefixes(file.path);
        const storageFilePath = file.path;
        if (await this.dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
            return undefined;
        }
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);

        return await serialized("file-" + prefixedFileName, async () => {
            try {
                const fileInfo = "stat" in file && "body" in file ? file : await this.loadFileWithInfo(storeFilePath);
                if (fileInfo.deleted) {
                    throw new Error(`Hidden file:${storeFilePath} is deleted. This should not be occurred.`);
                }
                const baseData = await this.__loadBaseSaveData(storeFilePath, true);
                if (baseData === false) throw new Error("Failed to load base data");
                if (baseData._rev && !forceWrite) {
                    // Not newly created,  we should check the content is actually modified.
                    const isSame = await isDocContentSame(readAsBlob(baseData), fileInfo.body);
                    if (isSame) {
                        this.updateLastProcessed(storeFilePath, baseData, fileInfo.stat);
                        // Not changed. skip.
                        // TODO: Mark as same?
                        return undefined;
                    }
                }
                const saveData: SavingEntry = {
                    ...baseData,
                    data: fileInfo.body,
                    mtime: fileInfo.stat.mtime,
                    size: fileInfo.stat.size,
                    children: [],
                    deleted: false,
                    type: baseData.datatype,
                };
                const ret = await this.localDatabase.putDBEntry(saveData);
                if (ret && ret.ok) {
                    saveData._rev = ret.rev;
                    this.updateLastProcessed(storeFilePath, saveData, fileInfo.stat);
                }
                const success = ret && ret.ok;
                this._log(`STORAGE --> DB:${storageFilePath}: (hidden) ${success ? "Done" : "Failed"}`);
                return success;
            } catch (ex) {
                this._log(`STORAGE --> DB:${storageFilePath}: (hidden) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async storeInternalFileToDatabaseWithBaseRevision(
        file: InternalFileInfo | UXFileInfo,
        baseRevision: string,
        createIfDifferent = true
    ): Promise<boolean> {
        const storeFilePath = stripAllPrefixes(file.path);
        const storageFilePath = file.path;
        if (await this.dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
            return false;
        }
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);

        return await serialized("file-" + prefixedFileName, async () => {
            try {
                const baseData = await this.getLiveInternalRevision(prefixedFileName, baseRevision);
                if (baseData === false) {
                    return false;
                }
                const fileInfo = "stat" in file && "body" in file ? file : await this.loadFileWithInfo(storeFilePath);
                if (fileInfo.deleted) {
                    throw new Error(`Hidden file:${storeFilePath} is deleted. This should not be occurred.`);
                }
                if (!baseData.deleted && !baseData._deleted) {
                    const loadedBase = await this.databaseFileAccess.fetchEntryFromMeta(baseData, true, true);
                    if (loadedBase && (await isDocContentSame(readAsBlob(loadedBase), fileInfo.body))) {
                        this.updateLastProcessed(storeFilePath, baseData, fileInfo.stat);
                        return true;
                    }
                }
                if (!createIfDifferent) {
                    this._log(
                        `Could not mark hidden file ${storeFilePath} as revision ${baseRevision}; the storage content differs`,
                        LOG_LEVEL_NOTICE
                    );
                    return false;
                }

                const storedRevision = await this.databaseFileAccess.storeWithBaseRevision(
                    {
                        ...fileInfo,
                        path: storeFilePath,
                        name: fileInfo.name || storeFilePath.split("/").pop() || "",
                        isInternal: true,
                    },
                    baseRevision,
                    true
                );
                if (storedRevision === false) {
                    return false;
                }
                this.updateLastProcessed(
                    storeFilePath,
                    {
                        ...baseData,
                        _rev: storedRevision,
                        path: prefixedFileName,
                        ctime: fileInfo.stat.ctime,
                        mtime: fileInfo.stat.mtime,
                        size: fileInfo.stat.size,
                        deleted: false,
                    },
                    fileInfo.stat
                );
                this._log(`STORAGE --> DB:${storageFilePath}: (hidden, selected branch) Done`);
                return true;
            } catch (ex) {
                this._log(`STORAGE --> DB:${storageFilePath}: (hidden, selected branch) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async deleteInternalFileOnDatabase(filenameSrc: FilePath, forceWrite = false) {
        const storeFilePath = filenameSrc;
        const storageFilePath = filenameSrc;
        const displayFileName = filenameSrc;
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);
        const mtime = new Date().getTime();
        if (await this.dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
            return undefined;
        }
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                const baseData = await this.__loadBaseSaveData(storeFilePath, false);
                if (baseData === false) throw new Error("Failed to load base data during deleting");
                if (baseData._conflicts !== undefined) {
                    for (const conflictRev of baseData._conflicts) {
                        await this.localDatabase.removeRevision(baseData._id, conflictRev);
                        this._log(
                            `STORAGE -x> DB: ${displayFileName}: (hidden) conflict removed ${baseData._rev} =>  ${conflictRev}`,
                            LOG_LEVEL_VERBOSE
                        );
                    }
                }
                if (baseData.deleted) {
                    this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) already deleted`, LOG_LEVEL_VERBOSE);
                    this.updateLastProcessedDeletion(storeFilePath, baseData);
                    return true;
                }
                const saveData: LoadedEntry = {
                    ...baseData,
                    mtime,
                    size: 0,
                    children: [],
                    deleted: true,
                    type: baseData.datatype,
                };
                const ret = await this.localDatabase.putRaw(saveData);
                if (ret && ret.ok) {
                    this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) Done`);
                    saveData._rev = ret.rev;
                    this.updateLastProcessedDeletion(storeFilePath, saveData);
                    return true;
                } else {
                    this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) Failed`);
                    return false;
                }
            } catch (ex) {
                this._log(`STORAGE -x> DB: ${displayFileName}: (hidden) Failed`);
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    // <-- Storage To Database Functions

    // --> Database To Storage Functions

    async extractInternalFileFromDatabase(
        storageFilePath: FilePath,
        force = false,
        metaEntry?: MetaEntry | LoadedEntry,
        preventDoubleProcess = true,
        onlyNew = false,
        includeDeletion = true,
        requiredLiveRevision?: string
    ) {
        const prefixedFileName = addPrefix(storageFilePath, ICHeader);
        if (await this.dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
            return undefined;
        }
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                // Check conflicted status
                const metaOnDB = requiredLiveRevision
                    ? await this.getLiveInternalRevision(prefixedFileName, requiredLiveRevision)
                    : metaEntry
                      ? metaEntry
                      : await this.localDatabase.getDBEntryMeta(prefixedFileName, { conflicts: true }, true);
                if (metaOnDB === false) throw new Error(`File not found on database.:${storageFilePath}`);
                // Prevent overwrite for Prevent overwriting while some conflicted revision exists.
                if (metaOnDB?._conflicts?.length) {
                    this._log(
                        `Hidden file ${storageFilePath} has conflicted revisions, to keep in safe, writing to storage has been prevented`,
                        LOG_LEVEL_INFO
                    );
                    return false;
                }
                if (preventDoubleProcess) {
                    const key = this.docToKey(metaOnDB);
                    if (this.getLastProcessedDatabaseKey(storageFilePath) == key && !force) {
                        this._log(
                            `STORAGE <-- DB: ${storageFilePath}: skipped (hidden, overwrite${force ? ", force" : ""}) (Previously processed)`
                        );
                        return;
                    }
                }
                if (onlyNew) {
                    // Check the file is new or not.
                    const dbMTime = getComparingMTime(metaOnDB, includeDeletion); // metaOnDB.mtime;
                    const storageStat = await this.storageAccess.statHidden(storageFilePath);
                    const storageMTimeActual = storageStat?.mtime ?? 0;
                    const storageMTime =
                        storageMTimeActual == 0 ? this.getLastProcessedFileMTime(storageFilePath) : storageMTimeActual;
                    const diff = compareMTime(storageMTime, dbMTime);
                    if (diff != TARGET_IS_NEW) {
                        this._log(
                            `STORAGE <-- DB: ${storageFilePath}: skipped (hidden, overwrite${force ? ", force" : ""}) (Not new)`
                        );
                        // And this case, we should update the last processed key.
                        this.updateLastProcessedDatabase(storageFilePath, metaOnDB);
                        if (storageStat) this.updateLastProcessedFile(storageFilePath, storageStat);
                        return;
                    }
                }
                const deleted = metaOnDB.deleted || metaOnDB._deleted || false;
                if (deleted) {
                    const result = await this.__deleteFile(storageFilePath);
                    if (result == "OK") {
                        this.updateLastProcessedDeletion(storageFilePath, metaOnDB);
                        return true;
                    } else if (result == "ALREADY") {
                        this.updateLastProcessedDatabase(storageFilePath, metaOnDB);
                        return true;
                    }
                    return false;
                } else {
                    const fileOnDB = await this.localDatabase.getDBEntryFromMeta(metaOnDB, false, true);
                    if (fileOnDB === false) {
                        throw new Error(`Failed to read file from database:${storageFilePath}`);
                    }
                    const resultStat = await this.__writeFile(storageFilePath, fileOnDB, force);
                    if (resultStat) {
                        this.updateLastProcessed(storageFilePath, metaOnDB, resultStat);
                        this.queueNotification(storageFilePath);
                        this._log(
                            `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Done`
                        );
                        return true;
                    }
                }
                return false;
            } catch (ex) {
                this._log(
                    `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Failed`
                );
                this._log(ex, LOG_LEVEL_VERBOSE);
                return false;
            }
        });
    }

    async extractInternalFileRevisionFromDatabase(
        storageFilePath: FilePath,
        revision: string,
        force = false
    ): Promise<boolean> {
        return Boolean(
            await this.extractInternalFileFromDatabase(storageFilePath, force, undefined, true, false, true, revision)
        );
    }

    async __checkIsNeedToWriteFile(storageFilePath: FilePath, content: string | ArrayBuffer): Promise<boolean> {
        try {
            const storageContent = await this.storageAccess.readHiddenFileAuto(storageFilePath);
            const needWrite = !(await isDocContentSame(storageContent, content));
            return needWrite;
        } catch (ex) {
            this._log(`Cannot check the content of ${storageFilePath}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return true;
        }
    }

    async __writeFile(storageFilePath: FilePath, fileOnDB: LoadedEntry, force: boolean): Promise<false | UXStat> {
        try {
            const statBefore = await this.storageAccess.statHidden(storageFilePath);
            const isExist = statBefore != null;
            const writeContent = readContent(fileOnDB);
            await this.ensureDir(storageFilePath);
            // We have to compare the content, so read it once.
            const needWrite =
                force || !isExist || (isExist && (await this.__checkIsNeedToWriteFile(storageFilePath, writeContent)));

            if (!needWrite) {
                this._log(`STORAGE <-- DB: ${storageFilePath}: skipped (hidden) Not changed`, LOG_LEVEL_DEBUG);
                return statBefore;
            }

            const writeResultStat = await this.writeFile(storageFilePath, writeContent, {
                mtime: fileOnDB.mtime,
                ctime: fileOnDB.ctime,
            });

            if (writeResultStat == null) {
                this._log(
                    `STORAGE <-- DB: ${storageFilePath}: written (hidden,new${force ? ", force" : ""}) Failed (writeResult)`
                );
                return false;
            }
            // await this.triggerEvent(storageFilePath);
            // markChangesAreSame(storageFilePath, getComparingMTime(writeResultStat), getComparingMTime(fileOnDB));
            this._log(`STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""})`);
            return writeResultStat;
        } catch (ex) {
            this._log(
                `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Failed`
            );
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    async __deleteFile(storageFilePath: FilePath): Promise<false | "OK" | "ALREADY"> {
        const result = await this.__removeFile(storageFilePath);
        if (result === false) {
            this._log(`STORAGE <x- DB: ${storageFilePath}: deleting (hidden) Failed`);
            return false;
        }
        if (result === "OK") {
            await this.triggerEvent(storageFilePath);
        }
        this._log(
            `STORAGE <x- DB: ${storageFilePath}: deleting (hidden) ${result == "OK" ? "Done" : "Already not found"}`
        );
        return result;
    }

    // <-- Database To Storage Functions

    _allSuspendExtraSync(): Promise<boolean> {
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
    async _allConfigureOptionalSyncFeature(mode: OptionalSyncFeatureMode) {
        await this.configureHiddenFileSync(mode);
        return true;
    }

    async configureHiddenFileSync(mode: OptionalSyncFeatureMode) {
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
    async scanInternalFileNames() {
        const findRoot = this.dependencies.getRootPath();

        const filenames = await this.getFiles(findRoot, (path) => this.isTargetFile(path));

        return filenames as FilePath[];
    }

    async scanInternalFiles(): Promise<InternalFileInfo[]> {
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

    async getFiles(path: string, checkFunction: (path: FilePath) => Promise<boolean> | boolean) {
        let w: HiddenFileSyncDirectoryListing;
        try {
            w = await this.dependencies.listFiles(path);
        } catch (ex) {
            this._log(`Could not traverse(HiddenSync):${path}`, LOG_LEVEL_INFO);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
        let files = [] as string[];
        for (const file of w.files) {
            if (!(await checkFunction(file as FilePath))) {
                continue;
            }
            files.push(file);
        }
        for (const v of w.folders) {
            if (!(await checkFunction(v as FilePath))) {
                continue;
            }
            files = files.concat(await this.getFiles(v, checkFunction));
        }
        return files;
    }
    // <-- Local Storage SubFunctions
}
