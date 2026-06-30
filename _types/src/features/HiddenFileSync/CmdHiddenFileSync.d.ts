// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type LoadedEntry, type FilePathWithPrefix, type FilePath, type DocumentID, type UXFileInfo, type UXStat, type MetaEntry, type UXDataWriteOptions } from "@lib/common/types.ts";
import { type InternalFileInfo } from "@/common/types.ts";
import { type CustomRegExp } from "@lib/common/utils.ts";
import { type MapLike } from "@/common/utils.ts";
import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import { LiveSyncCommands } from "@/features/LiveSyncCommands.ts";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type { LiveSyncCore } from "@/main.ts";
type SyncDirection = "push" | "pull" | "safe" | "pullForce" | "pushForce";
declare global {
    interface OPTIONAL_SYNC_FEATURES {
        FETCH: "FETCH";
        OVERWRITE: "OVERWRITE";
        MERGE: "MERGE";
        DISABLE: "DISABLE";
        DISABLE_HIDDEN: "DISABLE_HIDDEN";
    }
}
export declare class HiddenFileSync extends LiveSyncCommands {
    isThisModuleEnabled(): boolean;
    periodicInternalFileScanProcessor: PeriodicProcessor;
    get kvDB(): import("../../lib/src/interfaces/KeyValueDatabase").KeyValueDatabase;
    getConflictedDoc(path: FilePathWithPrefix, rev: string): Promise<false | import("@lib/common/types.ts").diff_result_leaf>;
    onunload(): void;
    onload(): void;
    private _everyOnDatabaseInitialized;
    _everyBeforeReplicate(showNotice: boolean): Promise<boolean>;
    private _everyOnloadAfterLoadSettings;
    updateSettingCache(): void;
    isReady(): boolean;
    performStartupScan(showNotice: boolean): Promise<void>;
    _everyOnResumeProcess(): Promise<boolean>;
    _everyRealizeSettingSyncMode(): Promise<boolean>;
    _anyProcessOptionalFileEvent(path: FilePath): Promise<boolean>;
    _anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | "newer">;
    _anyProcessOptionalSyncFiles(doc: LoadedEntry): Promise<boolean>;
    loadFileWithInfo(path: FilePath): Promise<UXFileInfo>;
    _fileInfoLastProcessed: MapLike<string, string>;
    _fileInfoLastKnown: MapLike<string, number>;
    _databaseInfoLastProcessed: MapLike<string, string>;
    statToKey(stat: UXStat | null): string;
    docToKey(doc: LoadedEntry | MetaEntry): string;
    fileToStatKey(file: FilePath, stat?: UXStat | null): Promise<string>;
    updateLastProcessedFile(file: FilePath, keySrc: string | UXStat): void;
    updateLastProcessedAsActualFile(file: FilePath, stat?: UXStat | null): Promise<void>;
    resetLastProcessedFile(targetFiles: FilePath[] | false): void;
    getLastProcessedFileMTime(file: FilePath): number;
    getLastProcessedFileKey(file: FilePath): string | undefined;
    getLastProcessedDatabaseKey(file: FilePath): string | undefined;
    updateLastProcessedDatabase(file: FilePath, keySrc: string | MetaEntry | LoadedEntry): void;
    updateLastProcessed(path: FilePath, db: MetaEntry | LoadedEntry, stat: UXStat): void;
    updateLastProcessedDeletion(path: FilePath, db: MetaEntry | LoadedEntry | false): void;
    ensureDir(path: FilePath): Promise<void>;
    writeFile(path: FilePath, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<UXStat | null>;
    __removeFile(path: FilePath): Promise<"OK" | "ALREADY" | false>;
    triggerEvent(path: FilePath): Promise<void>;
    updateLastProcessedAsActualDatabase(file: FilePath, doc?: MetaEntry | LoadedEntry | null | false): Promise<void>;
    resetLastProcessedDatabase(targetFiles: FilePath[] | false): void;
    adoptCurrentStorageFilesAsProcessed(targetFiles: FilePath[] | false): Promise<void>;
    adoptCurrentDatabaseFilesAsProcessed(targetFiles: FilePath[] | false): Promise<void>;
    semaphore: import("octagonal-wheels/concurrency/semaphore_v2").SemaphoreObject;
    serializedForEvent<T>(file: FilePath, fn: () => Promise<T>): Promise<T>;
    useStorageFiles(files: FilePath[], showNotice?: boolean, onlyNew?: boolean): Promise<void>;
    trackScannedStorageChanges(processFiles: FilePath[], showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeleted?: boolean): Promise<void>;
    scanAllStorageChanges(showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeleted?: boolean): Promise<void | null>;
    /**
     * check the file is changed or not, and if changed, process it.
     */
    trackStorageFileModification(path: FilePath, onlyNew?: boolean, forceWrite?: boolean, includeDeleted?: boolean): Promise<boolean | undefined>;
    pendingConflictChecks: Set<FilePathWithPrefix>;
    queueConflictCheck(path: FilePathWithPrefix): void;
    finishConflictCheck(path: FilePathWithPrefix): void;
    requeueConflictCheck(path: FilePathWithPrefix): void;
    resolveConflictOnInternalFiles(): Promise<void>;
    resolveByNewerEntry(id: DocumentID, path: FilePathWithPrefix, currentDoc: MetaEntry, currentRev: string, conflictedRev: string): Promise<void>;
    conflictResolutionProcessor: QueueProcessor<FilePathWithPrefix, {
        path: FilePathWithPrefix;
        revA: string;
        revB: string;
        id: DocumentID;
        doc: MetaEntry & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;
    }>;
    showJSONMergeDialogAndMerge(docA: LoadedEntry, docB: LoadedEntry): Promise<boolean>;
    getDocProps(doc: LoadedEntry): {
        id: DocumentID;
        rev: string | undefined;
        revDisplay: string;
        prefixedPath: FilePathWithPrefix;
        path: FilePath;
        isDeleted: boolean;
        shortenedId: string;
        shortenedPath: string;
    };
    processReplicationResult(doc: LoadedEntry): Promise<boolean>;
    cacheFileRegExps: Map<string, CustomRegExp[][]>;
    /**
     * Parses the regular expression settings for hidden file synchronization.
     * @returns An object containing the ignore and target filters.
     */
    parseRegExpSettings(): {
        ignoreFilter: CustomRegExp[];
        targetFilter: CustomRegExp[];
    };
    /**
     * Checks if the target file path matches the defined patterns.
     */
    isTargetFileInPatterns(path: string): boolean;
    cacheCustomisationSyncIgnoredFiles: Map<string, string[]>;
    /**
     * Gets the list of files ignored for customization synchronization.
     * @returns An array of ignored file paths (lowercase).
     */
    getCustomisationSynchronizationIgnoredFiles(): string[];
    /**
     * Checks if the given path is not ignored by customization synchronization.
     * @param path The file path to check.
     * @returns True if the path is not ignored; otherwise, false.
     */
    isNotIgnoredByCustomisationSync(path: string): boolean;
    isHiddenFileSyncHandlingPath(path: FilePath): boolean;
    isTargetFile(path: FilePath): Promise<boolean>;
    trackScannedDatabaseChange(processFiles: MetaEntry[], showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeletion?: boolean): Promise<void>;
    applyOfflineChanges(showNotice: boolean): Promise<void>;
    scanAllDatabaseChanges(showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeletion?: boolean): Promise<void | null>;
    useDatabaseFiles(files: MetaEntry[], showNotice?: boolean, onlyNew?: boolean): Promise<boolean>;
    trackDatabaseFileModification(path: FilePath, headerLine: string, preventDoubleProcess?: boolean, onlyNew?: boolean, meta?: MetaEntry | false, includeDeletion?: boolean): Promise<boolean>;
    queuedNotificationFiles: Set<string>;
    notifyConfigChange(): void;
    queueNotification(key: FilePath): void;
    rebuildMerging(showNotice: boolean, targetFiles?: FilePath[] | false): Promise<FilePath[]>;
    rebuildFromStorage(showNotice: boolean, targetFiles?: FilePath[] | false, onlyNew?: boolean): Promise<FilePath[]>;
    getAllDatabaseFiles(): Promise<MetaEntry[]>;
    rebuildFromDatabase(showNotice: boolean, targetFiles?: FilePath[] | false, onlyNew?: boolean): Promise<MetaEntry[]>;
    initialiseInternalFileSync(direction: SyncDirection, showMessage: boolean, targetFilesSrc?: string[] | false): Promise<void>;
    __loadBaseSaveData(file: FilePath, includeContent?: boolean): Promise<LoadedEntry | false>;
    storeInternalFileToDatabase(file: InternalFileInfo | UXFileInfo, forceWrite?: boolean): Promise<boolean | undefined>;
    deleteInternalFileOnDatabase(filenameSrc: FilePath, forceWrite?: boolean): Promise<boolean | undefined>;
    extractInternalFileFromDatabase(storageFilePath: FilePath, force?: boolean, metaEntry?: MetaEntry | LoadedEntry, preventDoubleProcess?: boolean, onlyNew?: boolean, includeDeletion?: boolean): Promise<boolean | undefined>;
    __checkIsNeedToWriteFile(storageFilePath: FilePath, content: string | ArrayBuffer): Promise<boolean>;
    __writeFile(storageFilePath: FilePath, fileOnDB: LoadedEntry, force: boolean): Promise<false | UXStat>;
    __deleteFile(storageFilePath: FilePath): Promise<false | "OK" | "ALREADY">;
    private _allAskUsingOptionalSyncFeature;
    private __askHiddenFileConfiguration;
    private _allSuspendExtraSync;
    private _allConfigureOptionalSyncFeature;
    configureHiddenFileSync(mode: keyof OPTIONAL_SYNC_FEATURES): Promise<void>;
    scanInternalFileNames(): Promise<FilePath[]>;
    scanInternalFiles(): Promise<InternalFileInfo[]>;
    getFiles(path: string, checkFunction: (path: FilePath) => Promise<boolean> | boolean): Promise<string[]>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
export {};
