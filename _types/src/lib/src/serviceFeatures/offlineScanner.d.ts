// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type FilePathWithPrefix, type FilePathWithPrefixLC, type MetaEntry, type UXFileInfoStub, type ObsidianLiveSyncSettings, type LOG_LEVEL } from "@lib/common/types";
import { type LogFunction } from "@lib/services/lib/logUtils";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";
/**
 * Collect deleted files that have expired according to retention policy.
 * @param host Services container
 * @param log Logging function
 * @returns Array of expired deletion history
 */
export declare function collectDeletedFiles(host: NecessaryServices<"setting" | "database", never>, log: LogFunction): Promise<void>;
/**
 * Get the file path from a meta entry.
 * This is a helper function to extract path from various document types.
 * @param doc Meta entry document
 * @returns Path string
 */
export declare function getPathFromEntry(host: NecessaryServices<"path", never>, doc: MetaEntry): FilePathWithPrefix;
/**
 * Synchronise a single file between database and storage based on freshness comparison.
 * @param host Services container
 * @param log Logging function
 * @param file Storage file information
 * @param doc Database entry
 */
export declare function syncFileBetweenDBandStorage(host: NecessaryServices<"setting" | "vault" | "path", "storageAccess" | "fileHandler">, log: LogFunction, file: UXFileInfoStub, doc: MetaEntry): Promise<void>;
export declare function canProceedScan(host: NecessaryServices<"keyValueDB" | "setting", never>, errorManager: UnresolvedErrorManager, log: LogFunction, showingNotice?: boolean, ignoreSuspending?: boolean): boolean;
/**
 * Convert file path to lower case if the settings indicate that filename case should be handled insensitively.
 * @param settings
 * @param path
 * @returns
 */
export declare function convertCase<T extends FilePathWithPrefix>(settings: ObsidianLiveSyncSettings, path: T): FilePathWithPrefixLC;
export declare function collectFilesOnStorage(host: NecessaryServices<"vault", "storageAccess">, settings: ObsidianLiveSyncSettings, log: LogFunction): Promise<{
    storageFileNameMap: {
        [k: string]: UXFileInfoStub;
    };
    storageFileNames: FilePathWithPrefix[];
    storageFileNameCI2CS: Record<FilePathWithPrefixLC, FilePathWithPrefix>;
}>;
export declare function collectDatabaseFiles(host: NecessaryServices<"database" | "vault" | "path", never>, settings: ObsidianLiveSyncSettings, log: LogFunction, showingNotice: boolean): Promise<{
    databaseFileNameMap: {
        [k: string]: MetaEntry;
    };
    databaseFileNames: FilePathWithPrefix[];
    databaseFileNameCI2CS: Record<FilePathWithPrefix, FilePathWithPrefixLC>;
}>;
export declare function updateToDatabase(host: NecessaryServices<"vault", "fileHandler">, log: LogFunction, logLevel: LOG_LEVEL, file: UXFileInfoStub): Promise<void>;
export declare function updateToStorage(host: NecessaryServices<"vault" | "path", "fileHandler">, log: LogFunction, logLevel: LOG_LEVEL, w: MetaEntry): Promise<void>;
export declare function syncStorageAndDatabase(host: NecessaryServices<"setting" | "vault" | "path", "storageAccess" | "fileHandler">, log: LogFunction, file: UXFileInfoStub, logLevel: LOG_LEVEL, doc: MetaEntry): Promise<void>;
export declare const FullScanModes: {
    readonly DB_APPLY: "db-apply";
    readonly NEWER_WINS: "newer-wins";
};
export declare const ExtraOnRemote: {
    /**
     * Delete database entries if they are missing on storage.
     */
    readonly DELETE_LOCAL_MISSING: "delete-local-missing";
};
export declare const ExtraOnLocal: {
    /**
     * Delete local files if they were deleted on database.
     */
    readonly DELETE_DB_DELETED: "delete-db-deleted";
    /**
     * Delete local files if they are missing on database or were deleted on database.
     */
    readonly DELETE_DB_MISSING: "delete-db-missing";
    /**
     * Merge local files to database
     */
    readonly APPEND_STORAGE_ONLY: "append-storage-only";
};
export interface FullScanOptions {
    mode: FullScanMode;
    extraOnLocal?: (typeof ExtraOnLocal)[keyof typeof ExtraOnLocal];
    extraOnRemote?: (typeof ExtraOnRemote)[keyof typeof ExtraOnRemote];
    omitEvents?: boolean;
    showingNotice?: boolean;
    ignoreSuspending?: boolean;
}
export type FullScanMode = (typeof FullScanModes)[keyof typeof FullScanModes];
type FilePair = {
    file: UXFileInfoStub;
    doc: MetaEntry;
} | {
    file: undefined;
    doc: MetaEntry;
} | {
    file: UXFileInfoStub;
    doc: undefined;
};
type FilePairState = "storage-only" | "db-only" | "db-only-deleted" | "both" | "both-db-deleted";
type FilePairAction = "update-db" | "update-storage" | "sync-newer" | "delete-local" | "delete-db" | "skip";
export declare function getFilePairState(pair: FilePair): FilePairState;
/**
 * Determine the action to be taken for a file pair based on its state and the selected scan options.
 */
export declare function resolveFilePairAction(state: FilePairState, options: FullScanOptions): FilePairAction;
/**
 * Synchronise all files between database and storage based on the selected mode and options.
 * @param host Core
 * @param log Logging function
 * @param errorManager Error manager
 * @param options Full scan options
 */
export declare function synchroniseAllFilesBetweenDBandStorage(host: NecessaryServices<"setting" | "vault" | "path" | "fileProcessing" | "database" | "keyValueDB", "storageAccess" | "fileHandler">, log: LogFunction, errorManager: UnresolvedErrorManager, options: FullScanOptions): Promise<boolean>;
export declare function normaliseFullScanOptions(showingNoticeOrOptions: Partial<FullScanOptions> | boolean | undefined, ignoreSuspending?: boolean): FullScanOptions;
/**
 * Perform a full scan and synchronisation between database and storage.
 * @param host Services container
 * @param log Logging function
 * @param errorManager Error manager
 * @param showingNotice Whether to show notices during scanning
 * @param ignoreSuspending Whether to ignore suspension settings
 * @returns True if scan completed successfully
 */
export declare function performFullScan(host: NecessaryServices<"setting" | "vault" | "path" | "fileProcessing" | "database" | "keyValueDB", "storageAccess" | "fileHandler">, log: LogFunction, errorManager: UnresolvedErrorManager, options?: Partial<FullScanOptions>): Promise<boolean>;
export declare function performFullScan(host: NecessaryServices<"setting" | "vault" | "path" | "fileProcessing" | "database" | "keyValueDB", "storageAccess" | "fileHandler">, log: LogFunction, errorManager: UnresolvedErrorManager, showingNotice?: boolean, ignoreSuspending?: boolean): Promise<boolean>;
/**
 * Associate the initialiser file feature with the app lifecycle events.
 * This function binds initialization handlers to the appropriate lifecycle events.
 * @param host Services container with required dependencies
 */
export declare function useOfflineScanner(host: NecessaryServices<"API" | "appLifecycle" | "setting" | "vault" | "path" | "database" | "databaseEvents" | "fileProcessing" | "keyValueDB" | "replicator", "storageAccess" | "fileHandler">): void;
export {};
