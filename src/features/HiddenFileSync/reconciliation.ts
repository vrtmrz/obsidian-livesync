import {
    type AnyEntry,
    type DocumentID,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type LOG_LEVEL,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { tryGetFilePath } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { serialized, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";

import { type InternalFileInfo, ICHeader, ICHeaderEnd } from "@/common/types.ts";
import {
    BASE_IS_NEW,
    compareMTime,
    EVEN,
    getLogLevel,
    isInternalMetadata,
    onlyInNTimes,
    TARGET_IS_NEW,
} from "@/common/utils.ts";
import {
    collectOptionalFileSyncFiles,
    type OptionalFileSyncFileTreeDependencies,
} from "@/features/optionalFileSyncFileTree.ts";
import type { HiddenFileSyncChangeProcessor } from "./hiddenFileSyncChangeProcessor.ts";
import type { HiddenFileSyncProcessedState } from "./hiddenFileSyncProcessedState.ts";
import { describeHiddenFileSyncDocument, getHiddenFileSyncComparisonMTime } from "./hiddenFileSyncState.ts";
import type {
    HiddenFileSyncInitialisationDirection as InitialisationDirection,
    HiddenFileSyncTestingRebuild,
    HiddenFileSyncTestingRebuildInterceptor,
} from "./hiddenFileSyncViews.ts";

export type { HiddenFileSyncInitialisationDirection as InitialisationDirection } from "./hiddenFileSyncViews.ts";

export type ReconciliationProgress = {
    log(message: string): void;
    once(message: string): void;
    done(message?: string): void;
};

type ReconciliationDatabase = Pick<LiveSyncLocalDB, "allDocsRaw">;
type ReconciliationStorage = Pick<StorageAccess, "statHidden">;

type ReconciliationProcessedState = Pick<
    HiddenFileSyncProcessedState,
    | "databaseStateKey"
    | "getLastProcessedDatabaseKey"
    | "getLastProcessedFileKey"
    | "getLastProcessedFileMTime"
    | "hasLastProcessedDatabase"
    | "hasLastProcessedFile"
    | "getLastProcessedFileKeys"
    | "resetLastProcessedDatabase"
    | "resetLastProcessedFile"
    | "storageStateKey"
    | "updateLastProcessed"
    | "updateLastProcessedAsActualDatabase"
    | "updateLastProcessedAsActualFile"
>;

type ReconciliationChangeProcessor = Pick<
    HiddenFileSyncChangeProcessor,
    "processStorageChange" | "processDatabaseChange"
>;

export type ReconciliationDependencies = OptionalFileSyncFileTreeDependencies & {
    getLocalDatabase(): ReconciliationDatabase;
    storageAccess: ReconciliationStorage;
    getRootPath(): string;
    getPath(entry: AnyEntry): FilePathWithPrefix;
    isTargetFile(path: FilePath): Promise<boolean>;
    isIgnoredByIgnoreFile(path: string): Promise<boolean>;
    createProgress(prefix?: string, level?: LOG_LEVEL): ReconciliationProgress;
    processedState: ReconciliationProcessedState;
    changeProcessor: ReconciliationChangeProcessor;
    log: LogFunction;
};

export type Reconciliation = {
    processStorageChange(
        path: FilePath,
        onlyNew?: boolean,
        forceWrite?: boolean,
        includeDeleted?: boolean
    ): Promise<boolean | undefined>;
    processDatabaseDocument(doc: LoadedEntry): Promise<boolean>;
    scanInternalFiles(): Promise<InternalFileInfo[]>;
    scanAllStorageChanges(
        showNotice?: boolean,
        onlyNew?: boolean,
        forceWriteAll?: boolean,
        includeDeleted?: boolean
    ): Promise<unknown>;
    scanAllDatabaseChanges(
        showNotice?: boolean,
        onlyNew?: boolean,
        forceWriteAll?: boolean,
        includeDeletion?: boolean
    ): Promise<unknown>;
    applyOfflineChanges(showNotice: boolean): Promise<unknown>;
    initialiseInternalFileSync(
        direction: InitialisationDirection,
        showMessage: boolean,
        targetFilesSrc?: string[] | false,
        initialisationProgress?: ReconciliationProgress
    ): Promise<void>;
    interceptRebuildMerging(interceptor: HiddenFileSyncTestingRebuildInterceptor): () => void;
    dispose(): void;
};

class ReconciliationOwner implements Reconciliation {
    private rebuildMergingHook: HiddenFileSyncTestingRebuild | undefined;

    constructor(private readonly dependencies: ReconciliationDependencies) {}

    private get localDatabase() {
        return this.dependencies.getLocalDatabase();
    }

    private get storageAccess() {
        return this.dependencies.storageAccess;
    }

    private getPath(entry: AnyEntry): FilePathWithPrefix {
        return this.dependencies.getPath(entry);
    }

    private _log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }

    private _verbose(message: unknown, key?: string): void {
        this._log(message, LOG_LEVEL_VERBOSE, key);
    }

    private _progress(prefix: string = "", level: LOG_LEVEL = LOG_LEVEL_NOTICE): ReconciliationProgress {
        return this.dependencies.createProgress(prefix, level);
    }

    async processStorageChange(
        path: FilePath,
        onlyNew = false,
        forceWrite = false,
        includeDeleted = true
    ): Promise<boolean | undefined> {
        if (!(await this.dependencies.isTargetFile(path))) {
            this._log(
                `Storage file tracking: Hidden file skipped: ${path} is filtered out by the defined patterns.`,
                LOG_LEVEL_VERBOSE
            );
            return false;
        }
        return await this.dependencies.changeProcessor.processStorageChange(path, onlyNew, forceWrite, includeDeleted);
    }

    async processDatabaseDocument(doc: LoadedEntry): Promise<boolean> {
        const info = describeHiddenFileSyncDocument(doc, this.getPath(doc));
        const path = info.path;
        const headerLine = `Tracking DB ${info.path} (${info.revDisplay}) :`;
        const ret = await this.trackDatabaseFileModification(path, headerLine);
        this._log(`${headerLine} Done: ${info.shortenedId})`, LOG_LEVEL_VERBOSE);
        return ret;
    }

    private async scanInternalFileNames(): Promise<FilePath[]> {
        const findRoot = this.dependencies.getRootPath();

        const filenames = await collectOptionalFileSyncFiles(this.dependencies, findRoot, {
            shouldInclude: (path) => this.dependencies.isTargetFile(path as FilePath),
            onError: (path, error) => {
                this._log(`Could not traverse(HiddenSync):${path}`, LOG_LEVEL_INFO);
                this._log(error, LOG_LEVEL_VERBOSE);
            },
        });

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

    private async adoptCurrentStorageFilesAsProcessed(targetFiles: FilePath[] | false): Promise<void> {
        const allFiles = await this.scanInternalFileNames();
        const files = targetFiles ? allFiles.filter((e) => targetFiles.some((t) => e.indexOf(t) !== -1)) : allFiles;
        for (const file of files) {
            await this.dependencies.processedState.updateLastProcessedAsActualFile(file);
        }
    }

    private async adoptCurrentDatabaseFilesAsProcessed(targetFiles: FilePath[] | false): Promise<void> {
        const allFiles = await this.getAllDatabaseFiles();
        const files = targetFiles
            ? allFiles.filter((e) => targetFiles.some((t) => e.path.indexOf(t) !== -1))
            : allFiles;
        for (const file of files) {
            const path = stripAllPrefixes(this.getPath(file));
            await this.dependencies.processedState.updateLastProcessedAsActualDatabase(path, file);
        }
    }

    private async trackScannedStorageChanges(
        processFiles: FilePath[],
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeleted = true
    ): Promise<void> {
        const logLevel = getLogLevel(showNotice);
        const p = this._progress(`[⚙ Storage -> DB ]\n`, logLevel);
        const notifyProgress = onlyInNTimes(100, (progress) => p.log(`${progress}/${processFiles.length}`));
        const processes = processFiles.map(async (file, i) => {
            try {
                await this.processStorageChange(file, onlyNew, forceWriteAll, includeDeleted);
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
    ): Promise<unknown> {
        return await skipIfDuplicated("scanAllStorageChanges", async () => {
            const logLevel = getLogLevel(showNotice);
            const p = this._progress(`[⚙ Scanning Storage -> DB ]\n`, logLevel);
            p.log(`Scanning storage files...`);
            const knownNames = [...this.dependencies.processedState.getLastProcessedFileKeys()] as FilePath[];
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
                    const key = this.dependencies.processedState.getLastProcessedFileKey(path);
                    const newKey = this.dependencies.processedState.storageStateKey(stat);
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

    private async trackScannedDatabaseChange(
        processFiles: MetaEntry[],
        showNotice: boolean = false,
        onlyNew = false,
        forceWriteAll = false,
        includeDeletion = true
    ): Promise<void> {
        const logLevel = getLogLevel(showNotice);
        const p = this._progress(`[⚙ DB -> Storage ]\n`, logLevel);
        const notifyProgress = onlyInNTimes(100, (progress) => p.log(`${progress}/${processFiles.length}`));
        const processes = processFiles.map(async (file) => {
            try {
                const path = stripAllPrefixes(this.getPath(file));
                if (!(await this.dependencies.isTargetFile(path))) {
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

    async applyOfflineChanges(showNotice: boolean): Promise<unknown> {
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
            const untrackedLocal = currentStorageFiles.filter(
                (e) => !this.dependencies.processedState.hasLastProcessedFile(e)
            );
            const untrackedDatabase = currentDatabaseFileNames.filter(
                (e) => !this.dependencies.processedState.hasLastProcessedDatabase(e)
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
                        await this.processStorageChange(file, true);
                    } else if (diff == TARGET_IS_NEW) {
                        // Database file is newer than the local file.
                        // So, we should apply the database file to the local file.
                        await this.trackDatabaseFileModification(file, "[Apply]", true, true, dbInfo);
                    } else if (diff == EVEN) {
                        // Both are same, we may skip this but should update the last processed key.
                        this.dependencies.processedState.updateLastProcessed(file, dbInfo, fileStat);
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
    ): Promise<unknown> {
        return await skipIfDuplicated("scanAllDatabaseChanges", async () => {
            const databaseFiles = await this.getAllDatabaseFiles();
            const files = databaseFiles.filter((e) => {
                const doc = e;
                const key = this.dependencies.processedState.databaseStateKey(doc);
                const path = stripAllPrefixes(this.getPath(doc));
                const lastKey = this.dependencies.processedState.getLastProcessedDatabaseKey(path);
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

    private async useDatabaseFiles(files: MetaEntry[], showNotice = false, onlyNew = false): Promise<boolean> {
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
        return await this.dependencies.changeProcessor.processDatabaseChange(path, headerLine, {
            preventDoubleProcess,
            onlyNew,
            metaEntry: meta,
            includeDeletion,
        });
    }

    private async rebuildMerging(showNotice: boolean, targetFiles: FilePath[] | false = false): Promise<FilePath[]> {
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
        this.dependencies.processedState.resetLastProcessedDatabase(targetFiles);
        this.dependencies.processedState.resetLastProcessedFile(targetFiles);
        const processes = [
            this.trackScannedStorageChanges(storageToDatabase, showNotice, false, true),
            this.useDatabaseFiles(databaseToStorage, showNotice, false),
        ];
        p.log("Start processing...");
        await Promise.all(processes);
        p.done();
        return [...allFileNames];
    }

    private async runRebuildMerging(showNotice: boolean, targetFiles: FilePath[] | false = false): Promise<FilePath[]> {
        return this.rebuildMergingHook
            ? await this.rebuildMergingHook(showNotice, targetFiles)
            : await this.rebuildMerging(showNotice, targetFiles);
    }

    private async rebuildFromStorage(
        showNotice: boolean,
        targetFiles: FilePath[] | false = false,
        onlyNew = false
    ): Promise<FilePath[]> {
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
        this.dependencies.processedState.resetLastProcessedFile(targetFiles);
        await this.trackScannedStorageChanges(currentFiles, showNotice, onlyNew, true);
        p.done();
        return currentFiles;
    }

    private async getAllDatabaseFiles(): Promise<MetaEntry[]> {
        const allFiles = (
            await this.localDatabase.allDocsRaw({ startkey: ICHeader, endkey: ICHeaderEnd, include_docs: true })
        ).rows
            .filter((e) => isInternalMetadata(e.id as DocumentID))
            .map((e) => e.doc) as MetaEntry[];
        const files = [] as MetaEntry[];
        for (const file of allFiles) {
            if (await this.dependencies.isTargetFile(stripAllPrefixes(this.getPath(file)))) {
                files.push(file);
            }
        }
        return files;
    }

    private async rebuildFromDatabase(
        showNotice: boolean,
        targetFiles: FilePath[] | false = false,
        onlyNew = false
    ): Promise<MetaEntry[]> {
        const logLevel = getLogLevel(showNotice);
        this._verbose(`Rebuilding hidden files from the local database.`);
        this._log(`Rebuilding hidden files from the local database.`, logLevel);
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
        this.dependencies.processedState.resetLastProcessedDatabase(targetFiles);
        p.log("Start processing...");
        await this.useDatabaseFiles(currentFiles, showNotice, onlyNew);
        p.done();
        return currentFiles;
    }

    async initialiseInternalFileSync(
        direction: InitialisationDirection,
        showMessage: boolean,
        // filesAll: InternalFileInfo[] | false = false,
        targetFilesSrc: string[] | false = false,
        initialisationProgress?: ReconciliationProgress
    ): Promise<void> {
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

    interceptRebuildMerging(interceptor: HiddenFileSyncTestingRebuildInterceptor): () => void {
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
    }

    dispose(): void {
        this.rebuildMergingHook = undefined;
    }
}

export function createReconciliation(dependencies: ReconciliationDependencies): Reconciliation {
    return new ReconciliationOwner(dependencies);
}
