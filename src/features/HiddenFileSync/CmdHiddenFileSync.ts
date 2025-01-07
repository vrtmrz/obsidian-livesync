import { normalizePath, type PluginManifest, type ListedFiles } from "../../deps.ts";
import {
    type LoadedEntry,
    type FilePathWithPrefix,
    type FilePath,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    MODE_SELECTIVE,
    MODE_PAUSED,
    type SavingEntry,
    type DocumentID,
    type FilePathWithPrefixLC,
    type UXFileInfo,
    type UXStat,
    LOG_LEVEL_DEBUG,
    type MetaEntry,
    type UXDataWriteOptions,
} from "../../lib/src/common/types.ts";
import { type InternalFileInfo, ICHeader, ICHeaderEnd } from "../../common/types.ts";
import {
    readAsBlob,
    isDocContentSame,
    sendSignal,
    readContent,
    createBlob,
    fireAndForget,
} from "../../lib/src/common/utils.ts";
import {
    compareMTime,
    unmarkChanges,
    getPath,
    isInternalMetadata,
    markChangesAreSame,
    PeriodicProcessor,
    TARGET_IS_NEW,
    scheduleTask,
    getDocProps,
    getLogLevel,
    autosaveCache,
    type MapLike,
    onlyInNTimes,
    BASE_IS_NEW,
    EVEN,
} from "../../common/utils.ts";
import { serialized, skipIfDuplicated } from "../../lib/src/concurrency/lock.ts";
import { JsonResolveModal } from "../HiddenFileCommon/JsonResolveModal.ts";
import { LiveSyncCommands } from "../LiveSyncCommands.ts";
import { addPrefix, stripAllPrefixes } from "../../lib/src/string_and_binary/path.ts";
import { QueueProcessor } from "../../lib/src/concurrency/processor.ts";
import { hiddenFilesEventCount, hiddenFilesProcessingCount } from "../../lib/src/mock_and_interop/stores.ts";
import type { IObsidianModule } from "../../modules/AbstractObsidianModule.ts";
import { EVENT_SETTING_SAVED, eventHub } from "../../common/events.ts";
import type { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB.ts";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
type SyncDirection = "push" | "pull" | "safe" | "pullForce" | "pushForce";

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

export class HiddenFileSync extends LiveSyncCommands implements IObsidianModule {
    _isThisModuleEnabled() {
        return this.plugin.settings.syncInternalFiles;
    }

    periodicInternalFileScanProcessor: PeriodicProcessor = new PeriodicProcessor(
        this.plugin,
        async () => this._isThisModuleEnabled() && this._isDatabaseReady() && (await this.scanAllStorageChanges(false))
    );

    get kvDB() {
        return this.plugin.kvDB;
    }
    getConflictedDoc(path: FilePathWithPrefix, rev: string) {
        return this.plugin.localDatabase.getConflictedDoc(path, rev);
    }
    onunload() {
        this.periodicInternalFileScanProcessor?.disable();
    }
    onload() {
        this.plugin.addCommand({
            id: "livesync-sync-internal",
            name: "(re)initialise hidden files between storage and database",
            callback: () => {
                if (this.isReady()) {
                    void this.initialiseInternalFileSync("safe", true);
                }
            },
        });
        this.plugin.addCommand({
            id: "livesync-scaninternal-storage",
            name: "Scan hidden file changes on the storage",
            callback: () => {
                if (this.isReady()) {
                    void this.scanAllStorageChanges(true);
                }
            },
        });
        this.plugin.addCommand({
            id: "livesync-scaninternal-database",
            name: "Scan hidden file changes on the local database",
            callback: () => {
                if (this.isReady()) {
                    void this.scanAllDatabaseChanges(true);
                }
            },
        });
        this.plugin.addCommand({
            id: "livesync-internal-scan-offline-changes",
            name: "Scan and apply all offline hidden-file changes",
            callback: () => {
                if (this.isReady()) {
                    void this.applyOfflineChanges(true);
                }
            },
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, () => {
            this.updateSettingCache();
        });
    }
    async $everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        this._fileInfoLastProcessed = await autosaveCache(this.kvDB, "hidden-file-lastProcessed");
        this._databaseInfoLastProcessed = await autosaveCache(this.kvDB, "hidden-file-lastProcessed-database");
        this._fileInfoLastKnown = await autosaveCache(this.kvDB, "hidden-file-lastKnown");
        return true;
    }
    async $everyOnDatabaseInitialized(showNotice: boolean) {
        if (this._isThisModuleEnabled()) {
            if (this._fileInfoLastProcessed.size == 0 && this._fileInfoLastProcessed.size == 0) {
                this._log(`No cache found. Performing startup scan.`, LOG_LEVEL_VERBOSE);
                await this.performStartupScan(true);
            } else {
                await this.performStartupScan(showNotice);
            }
        }
        return true;
    }
    async $everyBeforeReplicate(showNotice: boolean) {
        if (
            this._isThisModuleEnabled() &&
            this._isDatabaseReady() &&
            this.settings.syncInternalFilesBeforeReplication &&
            !this.settings.watchInternalFileChanges
        ) {
            await this.scanAllStorageChanges(showNotice);
        }
        return true;
    }

    $everyOnloadAfterLoadSettings(): Promise<boolean> {
        this.updateSettingCache();
        return Promise.resolve(true);
    }
    updateSettingCache() {
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",")
            .filter((e) => e)
            .map((e) => new RegExp(e, "i"));
        this.ignorePatterns = ignorePatterns;
        this.shouldSkipFile = [] as FilePathWithPrefixLC[];
        // Exclude files handled by customization sync
        const configDir = normalizePath(this.app.vault.configDir);
        const shouldSKip = !this.settings.usePluginSync
            ? []
            : Object.values(this.settings.pluginSyncExtendedSetting)
                  .filter((e) => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED)
                  .map((e) => e.files)
                  .flat()
                  .map((e) => `${configDir}/${e}`.toLowerCase());
        this.shouldSkipFile = shouldSKip as FilePathWithPrefixLC[];
        this._log(`Hidden file will skip ${this.shouldSkipFile.length} files`, LOG_LEVEL_INFO);
    }

    isReady() {
        if (!this._isMainReady) return false;
        if (this._isMainSuspended()) return false;
        if (!this._isThisModuleEnabled()) return false;
        return true;
    }
    shouldSkipFile = [] as FilePathWithPrefixLC[];

    async performStartupScan(showNotice: boolean) {
        await this.applyOfflineChanges(showNotice);
    }

    async $everyOnResumeProcess(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return true;
        if (this._isThisModuleEnabled()) {
            await this.performStartupScan(false);
        }
        this.periodicInternalFileScanProcessor.enable(
            this._isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        return true;
    }

    $everyRealizeSettingSyncMode(): Promise<boolean> {
        this.periodicInternalFileScanProcessor?.disable();
        if (this._isMainSuspended()) return Promise.resolve(true);
        if (!this.plugin.$$isReady()) return Promise.resolve(true);
        this.periodicInternalFileScanProcessor.enable(
            this._isThisModuleEnabled() && this.settings.syncInternalFilesInterval
                ? this.settings.syncInternalFilesInterval * 1000
                : 0
        );
        const ignorePatterns = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",")
            .filter((e) => e)
            .map((e) => new RegExp(e, "i"));
        this.ignorePatterns = ignorePatterns;
        return Promise.resolve(true);
    }

    async $anyProcessOptionalFileEvent(path: FilePath): Promise<boolean | undefined> {
        if (this.isReady()) {
            return await this.trackStorageFileModification(path);
        }
    }

    $anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | "newer"> {
        if (isInternalMetadata(path)) {
            this.queueConflictCheck(path);
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    }

    async $anyProcessOptionalSyncFiles(doc: LoadedEntry): Promise<boolean | undefined> {
        if (isInternalMetadata(doc._id)) {
            if (this._isThisModuleEnabled()) {
                //system file
                const filename = getPath(doc);
                if (await this.plugin.$$isTargetFile(filename)) {
                    // this.procInternalFile(filename);
                    await this.processReplicationResult(doc);
                    return true;
                } else {
                    this._log(`Skipped (Not target:${filename})`, LOG_LEVEL_VERBOSE);
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    async loadFileWithInfo(path: FilePath): Promise<UXFileInfo> {
        const stat = await this.plugin.storageAccess.statHidden(path);
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
        const content = await this.plugin.storageAccess.readHiddenFileAuto(path);
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
        if (!stat) stat = await this.plugin.storageAccess.statHidden(file);
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

    async updateLastProcessedAsActualFile(file: FilePath, stat?: UXStat | null | undefined) {
        if (!stat) stat = await this.plugin.storageAccess.statHidden(file);
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
            unmarkChanges(path);
        } else {
            markChangesAreSame(path, getComparingMTime(db), getComparingMTime(stat));
        }
    }
    updateLastProcessedDeletion(path: FilePath, db: MetaEntry | LoadedEntry | false) {
        unmarkChanges(path);
        if (db) this.updateLastProcessedDatabase(path, db);
        this.updateLastProcessedFile(path, this.statToKey(null));
    }
    async ensureDir(path: FilePath) {
        const isExists = await this.plugin.storageAccess.isExistsIncludeHidden(path);
        if (!isExists) {
            await this.plugin.storageAccess.ensureDir(path);
        }
    }

    async writeFile(path: FilePath, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<UXStat | null> {
        await this.plugin.storageAccess.writeHiddenFileAuto(path, data, opt);
        const stat = await this.plugin.storageAccess.statHidden(path);
        // this.updateLastProcessedFile(path, this.statToKey(stat));
        return stat;
    }

    async __removeFile(path: FilePath): Promise<"OK" | "ALREADY" | false> {
        try {
            if (!(await this.plugin.storageAccess.isExistsIncludeHidden(path))) {
                // Already deleted
                // this.updateLastProcessedFile(path, this.statToKey(null));
                return "ALREADY";
            }
            if (await this.plugin.storageAccess.removeHidden(path)) {
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
            // await this.app.vault.adapter.reconcileInternalFile(filename);
            await this.plugin.storageAccess.triggerHiddenFile(path);
        } catch (ex) {
            this._log("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
    }

    async updateLastProcessedAsActualDatabase(
        file: FilePath,
        doc?: MetaEntry | LoadedEntry | null | undefined | false
    ) {
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
        hiddenFilesEventCount.value++;
        const rel = await this.semaphore.acquire();
        try {
            return await serialized(`hidden-file-event:${file}`, async () => {
                hiddenFilesProcessingCount.value++;
                try {
                    return await fn();
                } finally {
                    hiddenFilesProcessingCount.value--;
                }
            });
        } finally {
            rel();
            hiddenFilesEventCount.value--;
        }
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
            const taskNameAndMeta = [...files].map(
                async (e) => [e, await this.plugin.storageAccess.statHidden(e)] as const
            );
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
        if (this.shouldSkipFile.some((e) => e.startsWith(path.toLowerCase()))) {
            this._log(`Hidden file skipped: ${path} is synchronized in customization sync.`, LOG_LEVEL_VERBOSE);
            return false;
        }
        try {
            return await this.serializedForEvent(path, async () => {
                let stat = await this.plugin.storageAccess.statHidden(path);
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

    queueConflictCheck(path: FilePathWithPrefix) {
        this.conflictResolutionProcessor.enqueue(path);
    }

    async resolveConflictOnInternalFiles() {
        // Scan all conflicted internal files
        const conflicted = this.localDatabase.findEntries(ICHeader, ICHeaderEnd, { conflicts: true });
        this.conflictResolutionProcessor.suspend();
        try {
            for await (const doc of conflicted) {
                if (!("_conflicts" in doc)) continue;
                if (isInternalMetadata(doc._id)) {
                    this.conflictResolutionProcessor.enqueue(doc.path);
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
        } else {
            this.conflictResolutionProcessor.enqueue(path);
        }
        // check the file again
    }
    conflictResolutionProcessor = new QueueProcessor(
        async (paths: FilePathWithPrefix[]) => {
            const path = paths[0];
            sendSignal(`cancel-internal-conflict:${path}`);
            try {
                // Retrieve data
                const id = await this.path2id(path, ICHeader);
                const doc = await this.localDatabase.getRaw<MetaEntry>(id, { conflicts: true });
                if (doc._conflicts === undefined) return [];
                if (doc._conflicts.length == 0) return [];
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
                    const result = await this.plugin.localDatabase.mergeObject(
                        path,
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
                        this.conflictResolutionProcessor.enqueue(path);
                        return [];
                    } else {
                        this._log(`Object merge is not applicable.`, LOG_LEVEL_VERBOSE);
                    }
                    return [{ path, revA, revB, id, doc }];
                }
                // When not JSON file, resolve conflicts by choosing a newer one.
                await this.resolveByNewerEntry(id, path, doc, revA, revB);
                return [];
            } catch (ex) {
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
                    if (docAMerge != false && docBMerge != false) {
                        if (await this.showJSONMergeDialogAndMerge(docAMerge, docBMerge)) {
                            // Again for other conflicted revisions.
                            this.conflictResolutionProcessor.enqueue(path);
                        }
                        return;
                    } else {
                        // If either revision could not read, force resolving by the newer one.
                        await this.resolveByNewerEntry(id, path, doc, revA, revB);
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

    showJSONMergeDialogAndMerge(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean> {
        return new Promise((res) => {
            this._log("Opening data-merging dialog", LOG_LEVEL_VERBOSE);
            const docs = [docA, docB];
            const strippedPath = stripAllPrefixes(docA.path);
            const storageFilePath = strippedPath;
            const storeFilePath = strippedPath;
            const displayFilename = `${storeFilePath}`;
            // const path = this.prefixedConfigDir2configDir(stripAllPrefixes(docA.path)) || docA.path;
            const modal = new JsonResolveModal(this.app, storageFilePath, [docA, docB], async (keep, result) => {
                // modal.close();
                try {
                    // const filename = storeFilePath;
                    let needFlush = false;
                    if (!result && !keep) {
                        this._log(`Skipped merging: ${displayFilename}`);
                        res(false);
                        return;
                    }
                    //Delete old revisions
                    if (result || keep) {
                        for (const doc of docs) {
                            if (doc._rev != keep) {
                                if (await this.localDatabase.deleteDBEntry(this.getPath(doc), { rev: doc._rev })) {
                                    this._log(`Conflicted revision has been deleted: ${displayFilename}`);
                                    needFlush = true;
                                }
                            }
                        }
                    }
                    if (!keep && result) {
                        const isExists = await this.plugin.storageAccess.isExistsIncludeHidden(storageFilePath);
                        if (!isExists) {
                            await this.plugin.storageAccess.ensureDir(storageFilePath);
                        }
                        const stat = await this.writeFile(storageFilePath, result);
                        if (!stat) {
                            throw new Error("Stat failed");
                        }
                        const mtime = getComparingMTime(stat);
                        await this.storeInternalFileToDatabase(
                            { path: storageFilePath, mtime, ctime: stat?.ctime ?? mtime, size: stat?.size ?? 0 },
                            true
                        );
                        await this.triggerEvent(storageFilePath);
                        this._log(`STORAGE <-- DB:${displayFilename}: written (hidden,merged)`);
                    }
                    if (needFlush) {
                        if (await this.extractInternalFileFromDatabase(storeFilePath, false)) {
                            this._log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged)`);
                        } else {
                            this._log(`STORAGE --> DB:${displayFilename}: extracted (hidden,merged) Failed`);
                        }
                    }
                    res(true);
                } catch (ex) {
                    this._log("Could not merge conflicted json");
                    this._log(ex, LOG_LEVEL_VERBOSE);
                    res(false);
                }
            });
            modal.open();
        });
    }
    // <-- Conflict processing

    // --> Event Source Handler (Database)

    async processReplicationResult(doc: LoadedEntry): Promise<boolean> {
        const info = getDocProps(doc);
        const path = info.path;
        const headerLine = `Tracking DB ${info.path} (${info.revDisplay}) :`;
        const ret = await this.trackDatabaseFileModification(path, headerLine);
        this._log(`${headerLine} Done: ${info.shortenedId})`, LOG_LEVEL_VERBOSE);
        return ret;
    }

    // <-- Event Source Handler (Database)

    // --> Database Event Functions

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
                await this.trackDatabaseFileModification(
                    path,
                    "[Hidden file scan]",
                    !forceWriteAll,
                    onlyNew,
                    file,
                    includeDeletion
                );
                notifyProgress();
            } catch (ex) {
                this._log(`Failed to process storage change file:${file}`, logLevel);
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
                currentDatabaseFiles.map((e) => [stripAllPrefixes(getPath(e)), e])
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
                    const fileStat = await this.plugin.storageAccess.statHidden(file);
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
                this._log(`Failed to process database changes:${file}`);
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
                    this.conflictResolutionProcessor.enqueue(path);
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
        try {
            //@ts-ignore
            const manifests = Object.values(this.app.plugins.manifests) as any as PluginManifest[];
            //@ts-ignore
            const enabledPlugins = this.app.plugins.enabledPlugins as Set<string>;
            const enabledPluginManifests = manifests.filter((e) => enabledPlugins.has(e.id));
            const modifiedManifests = enabledPluginManifests.filter((e) => updatedFolders.indexOf(e?.dir ?? "") >= 0);
            for (const manifest of modifiedManifests) {
                // If notified about plug-ins, reloading Obsidian may not be necessary.
                const updatePluginId = manifest.id;
                const updatePluginName = manifest.name;
                this.plugin.confirm.askInPopup(
                    `updated-${updatePluginId}`,
                    `Files in ${updatePluginName} has been updated!\nPress {HERE} to reload ${updatePluginName}, or press elsewhere to dismiss this message.`,
                    (anchor) => {
                        anchor.text = "HERE";
                        anchor.addEventListener("click", () => {
                            fireAndForget(async () => {
                                this._log(
                                    `Unloading plugin: ${updatePluginName}`,
                                    LOG_LEVEL_NOTICE,
                                    "plugin-reload-" + updatePluginId
                                );
                                // @ts-ignore
                                await this.app.plugins.unloadPlugin(updatePluginId);
                                // @ts-ignore
                                await this.app.plugins.loadPlugin(updatePluginId);
                                this._log(
                                    `Plugin reloaded: ${updatePluginName}`,
                                    LOG_LEVEL_NOTICE,
                                    "plugin-reload-" + updatePluginId
                                );
                            });
                        });
                    }
                );
            }
        } catch (ex) {
            this._log("Error on checking plugin status.");
            this._log(ex, LOG_LEVEL_VERBOSE);
        }

        // If something changes left, notify for reloading Obsidian.
        if (updatedFolders.indexOf(this.plugin.app.vault.configDir) >= 0) {
            if (!this.plugin.$$isReloadingScheduled()) {
                this.plugin.confirm.askInPopup(
                    `updated-any-hidden`,
                    `Some setting files have been modified\nPress {HERE} to schedule a reload of Obsidian, or press elsewhere to dismiss this message.`,
                    (anchor) => {
                        anchor.text = "HERE";
                        anchor.addEventListener("click", () => {
                            this.plugin.$$scheduleAppReload();
                        });
                    }
                );
            }
        }
    }

    queueNotification(key: FilePath) {
        if (this.settings.suppressNotifyHiddenFilesChange) {
            return;
        }
        const configDir = this.plugin.app.vault.configDir;
        if (!key.startsWith(configDir)) return;
        const dirName = key.split("/").slice(0, -1).join("/");
        this.queuedNotificationFiles.add(dirName);
        scheduleTask("notify-config-change", 1000, () => {
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
        const allDatabaseMap = new Map(allDatabaseFiles.map((e) => [stripAllPrefixes(getPath(e)), e]));
        const currentDatabaseFiles = targetFiles
            ? allDatabaseFiles.filter((e) => targetFiles.some((f) => f == stripAllPrefixes(getPath(e))))
            : allDatabaseFiles;

        const allFileNames = new Set([
            ...currentStorageFiles,
            ...currentDatabaseFiles.map((e) => stripAllPrefixes(getPath(e))),
        ]);
        const storageToDatabase = [] as FilePath[];
        const databaseToStorage = [] as MetaEntry[];

        const eachProgress = onlyInNTimes(100, (progress) => p.log(`Checking ${progress}/${allFileNames.size}`));
        for (const file of allFileNames) {
            eachProgress();
            const storageMTime = await this.plugin.storageAccess.statHidden(file);
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
        return allFiles;
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
            ? allFiles.filter((e) => targetFiles.some((f) => f == stripAllPrefixes(getPath(e))))
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
        targetFilesSrc: string[] | false = false
    ) {
        const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
        const p = this._progress("[⚙ Initialise]\n", logLevel);
        // p.log("Resolving conflicts before starting...");
        // await this.resolveConflictOnInternalFiles();
        p.log("Initialising hidden files sync...");
        // TODO: Handling ignore files cannot be performed to the hidden files.

        const targetFiles = targetFilesSrc
            ? targetFilesSrc.map((e) => stripAllPrefixes(e as FilePathWithPrefix))
            : false;
        if (direction == "pushForce" || direction == "push") {
            const onlyNew = direction == "push";
            p.log(`Started: Storage --> Database ${onlyNew ? "(Only New)" : ""}`);
            const updatedFiles = await this.rebuildFromStorage(showMessage, targetFiles, onlyNew);
            // making doubly sure, No more losing files.
            // I did so many times during the development.
            await this.adoptCurrentStorageFilesAsProcessed(updatedFiles);
            await this.adoptCurrentDatabaseFilesAsProcessed(updatedFiles);
            // And, scan other changes on the database (i.e. files which are on only other devices)
            await this.scanAllStorageChanges(showMessage, true, false);
            await this.scanAllDatabaseChanges(showMessage, true, false);
        }
        if (direction == "pullForce" || direction == "pull") {
            const onlyNew = direction == "pull";
            p.log(`Started: Database --> Storage ${onlyNew ? "(Only New)" : ""}`);
            const updatedEntries = await this.rebuildFromDatabase(showMessage, targetFiles, onlyNew);
            const updatedFiles = updatedEntries.map((e) => stripAllPrefixes(getPath(e)));
            // making doubly sure, No more losing files.
            await this.adoptCurrentStorageFilesAsProcessed(updatedFiles);
            await this.adoptCurrentDatabaseFilesAsProcessed(updatedFiles);
            // And, scan other changes on the database (i.e. files which are on only other devices)
            await this.scanAllDatabaseChanges(showMessage, true, false);
            await this.scanAllStorageChanges(showMessage, true, false);
        }
        if (direction == "safe") {
            p.log(`Started: Database <--> Storage (by modified date)`);
            const updatedFiles = await this.rebuildMerging(showMessage, targetFiles);
            await this.adoptCurrentStorageFilesAsProcessed(updatedFiles);
            await this.adoptCurrentDatabaseFilesAsProcessed(updatedFiles);
            // And, scan other changes on the database (i.e. files which are on only other devices)
            await this.scanAllStorageChanges(showMessage, true, false);
            await this.scanAllDatabaseChanges(showMessage, true, false);
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

    async storeInternalFileToDatabase(file: InternalFileInfo | UXFileInfo, forceWrite = false) {
        const storeFilePath = stripAllPrefixes(file.path as FilePath);
        const storageFilePath = file.path;
        if (await this.plugin.$$isIgnoredByIgnoreFiles(storageFilePath)) {
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

    async deleteInternalFileOnDatabase(filenameSrc: FilePath, forceWrite = false) {
        const storeFilePath = filenameSrc;
        const storageFilePath = filenameSrc;
        const displayFileName = filenameSrc;
        const prefixedFileName = addPrefix(storeFilePath, ICHeader);
        const mtime = new Date().getTime();
        if (await this.plugin.$$isIgnoredByIgnoreFiles(storageFilePath)) {
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
        includeDeletion = true
    ) {
        const prefixedFileName = addPrefix(storageFilePath, ICHeader);
        if (await this.plugin.$$isIgnoredByIgnoreFiles(storageFilePath)) {
            return undefined;
        }
        return await serialized("file-" + prefixedFileName, async () => {
            try {
                // Check conflicted status
                const metaOnDB = metaEntry
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
                    const storageStat = await this.plugin.storageAccess.statHidden(storageFilePath);
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
                    const result = await this._deleteFile(storageFilePath);
                    if (result == "OK") {
                        this.updateLastProcessedDeletion(storageFilePath, metaOnDB);
                        return true;
                    } else if (result == "ALREADY") {
                        this.updateLastProcessedDatabase(storageFilePath, metaOnDB);
                        return true;
                    }
                    return false;
                } else {
                    const fileOnDB = await this.localDatabase.getDBEntryFromMeta(metaOnDB, {}, false, true, true);
                    if (fileOnDB === false) {
                        throw new Error(`Failed to read file from database:${storageFilePath}`);
                    }
                    const resultStat = await this._writeFile(storageFilePath, fileOnDB, force);
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

    async __checkIsNeedToWriteFile(storageFilePath: FilePath, content: string | ArrayBuffer): Promise<boolean> {
        try {
            const storageContent = await this.plugin.storageAccess.readHiddenFileAuto(storageFilePath);
            const needWrite = !(await isDocContentSame(storageContent, content));
            return needWrite;
        } catch (ex) {
            this._log(`Cannot check the content of ${storageFilePath}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return true;
        }
    }

    async _writeFile(storageFilePath: FilePath, fileOnDB: LoadedEntry, force: boolean): Promise<false | UXStat> {
        try {
            const statBefore = await this.plugin.storageAccess.statHidden(storageFilePath);
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

    async _deleteFile(storageFilePath: FilePath): Promise<false | "OK" | "ALREADY"> {
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

    async $allAskUsingOptionalSyncFeature(opt: { enableFetch?: boolean; enableOverwrite?: boolean }) {
        await this._askHiddenFileConfiguration(opt);
        return true;
    }
    async _askHiddenFileConfiguration(opt: { enableFetch?: boolean; enableOverwrite?: boolean }) {
        const messageFetch = `${opt.enableFetch ? `> - Fetch: Use the files stored from other devices. Choose this option if you have already configured hidden file synchronization on those devices and wish to accept their files.\n` : ""}`;
        const messageOverwrite = `${opt.enableOverwrite ? `> - Overwrite: Use the files from this device. Select this option if you want to overwrite the files stored on other devices.\n` : ""}`;
        const messageMerge = `> - Merge: Merge the files from this device with those on other devices. Choose this option if you wish to combine files from multiple sources.
>  However, please be reminded that merging may cause conflicts if the files are not identical. Additionally, this process may occur within the same folder, potentially breaking your plug-in or theme settings that comprise multiple files.\n`;
        const message = `Would you like to enable **Hidden File Synchronization**?

> [!DETAILS]-
> This feature allows you to synchronize all hidden files without any user interaction.
> To enable this feature, you should choose one of the following options:
${messageFetch}${messageOverwrite}${messageMerge}

> [!IMPORTANT]
> Please keep in mind that enabling this feature alongside customisation sync may override certain behaviors.`;
        const CHOICE_FETCH = "Fetch";
        const CHOICE_OVERWRITE = "Overwrite";
        const CHOICE_MERGE = "Merge";
        const CHOICE_DISABLE = "Disable";
        const choices = [];
        if (opt?.enableFetch) {
            choices.push(CHOICE_FETCH);
        }
        if (opt?.enableOverwrite) {
            choices.push(CHOICE_OVERWRITE);
        }
        choices.push(CHOICE_MERGE);
        choices.push(CHOICE_DISABLE);

        const ret = await this.plugin.confirm.confirmWithMessage(
            "Hidden file sync",
            message,
            choices,
            CHOICE_DISABLE,
            40
        );
        if (ret == CHOICE_FETCH) {
            await this.configureHiddenFileSync("FETCH");
        } else if (ret == CHOICE_OVERWRITE) {
            await this.configureHiddenFileSync("OVERWRITE");
        } else if (ret == CHOICE_MERGE) {
            await this.configureHiddenFileSync("MERGE");
        } else if (ret == CHOICE_DISABLE) {
            await this.configureHiddenFileSync("DISABLE_HIDDEN");
        }
    }

    $allSuspendExtraSync(): Promise<boolean> {
        if (this.plugin.settings.syncInternalFiles) {
            this._log(
                "Hidden file synchronization have been temporarily disabled. Please enable them after the fetching, if you need them.",
                LOG_LEVEL_NOTICE
            );
            this.plugin.settings.syncInternalFiles = false;
        }
        return Promise.resolve(true);
    }

    // --> Configuration handling
    async $anyConfigureOptionalSyncFeature(mode: "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN") {
        await this.configureHiddenFileSync(mode);
    }

    async configureHiddenFileSync(mode: "FETCH" | "OVERWRITE" | "MERGE" | "DISABLE" | "DISABLE_HIDDEN") {
        if (
            mode != "FETCH" &&
            mode != "OVERWRITE" &&
            mode != "MERGE" &&
            mode != "DISABLE" &&
            mode != "DISABLE_HIDDEN"
        ) {
            return;
        }

        if (mode == "DISABLE" || mode == "DISABLE_HIDDEN") {
            // await this.plugin.$allSuspendExtraSync();
            this.plugin.settings.syncInternalFiles = false;
            await this.plugin.saveSettings();
            return;
        }
        this._log("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
        if (mode == "FETCH") {
            await this.initialiseInternalFileSync("pullForce", true);
        } else if (mode == "OVERWRITE") {
            await this.initialiseInternalFileSync("pushForce", true);
        } else if (mode == "MERGE") {
            await this.initialiseInternalFileSync("safe", true);
        }
        this.plugin.settings.useAdvancedMode = true;
        this.plugin.settings.syncInternalFiles = true;

        await this.plugin.saveSettings();
        this._log(`Done! Restarting the app is strongly recommended!`, LOG_LEVEL_NOTICE);
    }
    // <-- Configuration handling

    // --> Local Storage SubFunctions
    ignorePatterns: RegExp[] = [];
    async scanInternalFileNames() {
        const configDir = normalizePath(this.app.vault.configDir);
        const ignoreFilter = this.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",")
            .filter((e) => e)
            .map((e) => new RegExp(e, "i"));
        const synchronisedInConfigSync = !this.settings.usePluginSync
            ? []
            : Object.values(this.settings.pluginSyncExtendedSetting)
                  .filter((e) => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED)
                  .map((e) => e.files)
                  .flat()
                  .map((e) => `${configDir}/${e}`.toLowerCase());
        const root = this.app.vault.getRoot();
        const findRoot = root.path;

        const filenames = (await this.getFiles(findRoot, [], undefined, ignoreFilter))
            .filter((e) => e.startsWith("."))
            .filter((e) => !e.startsWith(".trash"));
        const files = filenames.filter((path) =>
            synchronisedInConfigSync.every((filterFile) => !path.toLowerCase().startsWith(filterFile))
        );
        return files as FilePath[];
    }

    async scanInternalFiles(): Promise<InternalFileInfo[]> {
        const fileNames = await this.scanInternalFileNames();
        const files = fileNames.map(async (e) => {
            return {
                path: e,
                stat: await this.plugin.storageAccess.statHidden(e), // this.plugin.vaultAccess.adapterStat(e)
            };
        });
        const result: InternalFileInfo[] = [];
        for (const f of files) {
            const w = await f;
            if (await this.plugin.$$isIgnoredByIgnoreFiles(w.path)) {
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

    async getFiles(path: string, ignoreList: string[], filter?: RegExp[], ignoreFilter?: RegExp[]) {
        let w: ListedFiles;
        try {
            w = await this.app.vault.adapter.list(path);
        } catch (ex) {
            this._log(`Could not traverse(HiddenSync):${path}`, LOG_LEVEL_INFO);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return [];
        }
        const filesSrc = [
            ...w.files
                .filter((e) => !ignoreList.some((ee) => e.endsWith(ee)))
                .filter((e) => !filter || filter.some((ee) => e.match(ee)))
                .filter((e) => !ignoreFilter || ignoreFilter.every((ee) => !e.match(ee))),
        ];
        let files = [] as string[];
        for (const file of filesSrc) {
            if (!(await this.plugin.$$isIgnoredByIgnoreFiles(file))) {
                files.push(file);
            }
        }

        L1: for (const v of w.folders) {
            for (const ignore of ignoreList) {
                if (v.endsWith(ignore)) {
                    continue L1;
                }
            }
            if (ignoreFilter && ignoreFilter.some((e) => v.match(e))) {
                continue L1;
            }
            if (await this.plugin.$$isIgnoredByIgnoreFiles(v)) {
                continue L1;
            }
            files = files.concat(await this.getFiles(v, ignoreList, filter, ignoreFilter));
        }
        return files;
    }

    // <-- Local Storage SubFunctions
}
