// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { FilePath, LoadedEntry, MetaEntry, DocumentID } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { type CustomRegExp } from "@lib/common/utils.ts";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";
/**
 * Generates a progress logger that tracks long-running synchronisation operations.
 *
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param prefix - The message prefix to prepend to log statements.
 * @param level - The log level to use.
 * @returns An object containing `log`, `once`, and `done` progress log methods.
 */
export declare function getProgress(log: LogFunction, state: HiddenFileSyncState, prefix?: string, level?: any): { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    log: (msg: string) => void;
    once: (msg: string) => void;
    done: (msg?: string) => void;
};
/**
 * Parses ignore and target custom regular expression filters from settings, caching the compiled filters.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @returns Compiled regular expressions for target and ignored files.
 */
export declare function parseRegExpSettings(host: HiddenFileSyncHost, state: HiddenFileSyncState): {
    ignoreFilter: CustomRegExp[];
    targetFilter: CustomRegExp[];
};
/**
 * Checks if a given file path is matched by target patterns and not ignored by ignore patterns.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The file path to check.
 * @returns True if the path is a synchronisation target based on pattern settings; otherwise, false.
 */
export declare function isTargetFileInPatterns(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: string): boolean;
/**
 * Determines which files are synchronised by the customisation sync feature and should be ignored by this module.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @returns A list of ignored file path strings.
 */
export declare function getCustomisationSynchronizationIgnoredFiles(host: HiddenFileSyncHost, state: HiddenFileSyncState): string[];
/**
 * Checks whether a path is not ignored due to customisation synchronisation settings.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The file path to check.
 * @returns True if not ignored by customisation synchronisation; otherwise, false.
 */
export declare function isNotIgnoredByCustomisationSync(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: string): boolean;
/**
 * Verifies if the path represents a hidden configuration file.
 * Configuration files start with '.' and are not within the '.trash' folder.
 *
 * @param path - The file path to verify.
 * @returns True if the path represents a hidden file; otherwise, false.
 */
export declare function isHiddenFileSyncHandlingPath(path: FilePath): boolean;
/**
 * Validates if the path is a synchronisation target, checking pattern filters, customisation sync rules, hidden file rules, and ignore file rules.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param path - The target file path.
 * @returns True if the file should be synchronised; otherwise, false.
 */
export declare function isTargetFile(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, path: FilePath): Promise<boolean>;
/**
 * Executes a function sequentially for an event using locks and semaphores to prevent race conditions during file processing.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @param file - The file path.
 * @param fn - The function to run.
 */
export declare function serializedForEvent<T>(host: HiddenFileSyncHost, state: HiddenFileSyncState, file: FilePath, fn: () => Promise<T>): Promise<T>;
/**
 * Recursively lists files inside the specified directory path that pass the verification check function.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @param path - The directory path to list.
 * @param checkFunction - The verification callback.
 * @returns A list of file paths.
 */
export declare function getFiles(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: string, checkFunction: (path: FilePath) => Promise<boolean> | boolean): Promise<string[]>;
/**
 * Scans the local workspace vault for hidden configuration files that are target synchronisation candidates.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @returns A list of hidden file paths.
 */
export declare function scanInternalFileNames(host: HiddenFileSyncHost, state: HiddenFileSyncState): Promise<FilePath[]>;
/**
 * Queries the local database for all hidden configuration file metadata documents.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @returns A list of database metadata entries.
 */
export declare function getAllDatabaseFiles(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState): Promise<MetaEntry[]>;
/**
 * Tracks scanned storage changes, synchronising them to the database in bulk.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param processFiles - The list of local files to process.
 * @param showNotice - Whether to show system notices.
 * @param onlyNew - If true, only updates database files if they are newer.
 * @param forceWriteAll - If true, forces database updates.
 * @param includeDeleted - Whether to process deleted files.
 */
export declare function trackScannedStorageChanges(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, processFiles: FilePath[], showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeleted?: boolean): Promise<void>;
/**
 * Scans all local storage files and compares them with the cache to track any new changes to be saved to the database.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param showNotice - Whether to show progress notices.
 * @param onlyNew - If true, only synchronises newer files.
 * @param forceWriteAll - If true, forces file updates.
 * @param includeDeleted - Whether to process deleted files.
 * @returns True if scanning and updates succeeded; otherwise, false.
 */
export declare function scanAllStorageChanges(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeleted?: boolean): Promise<boolean>;
/**
 * Tracks a single storage file modification, saving updates or deleting database records accordingly.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param path - The local storage path.
 * @param onlyNew - If true, only updates the database if the storage file is newer.
 * @param forceWrite - If true, forces database updates.
 * @param includeDeleted - Whether to track deletions.
 * @returns True if modification tracking succeeded, or false if skipped/failed.
 */
export declare function trackStorageFileModification(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, path: FilePath, onlyNew?: boolean, forceWrite?: boolean, includeDeleted?: boolean): Promise<boolean | undefined>;
/**
 * Applies offline database and storage modifications by comparing differences on untracked files.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param showNotice - Whether to show notifications.
 */
export declare function applyOfflineChanges(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, showNotice: boolean): Promise<void>;
/**
 * Tracks scanned database changes, writing updates to the local storage in bulk.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param processFiles - Database entries to track.
 * @param showNotice - Whether to show notices.
 * @param onlyNew - If true, only overwrites local files if the database entry is newer.
 * @param forceWriteAll - If true, forces local file updates.
 * @param includeDeletion - Whether to apply database deletions.
 */
export declare function trackScannedDatabaseChange(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, processFiles: MetaEntry[], showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeletion?: boolean): Promise<void>;
/**
 * Scans the database for changed metadata documents to update the local storage.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param showNotice - Whether to show notices.
 * @param onlyNew - If true, only updates the local storage if database changes are newer.
 * @param forceWriteAll - If true, forces storage updates.
 * @param includeDeletion - Whether to apply deletions.
 * @returns True if database scan and application succeeded; otherwise, false.
 */
export declare function scanAllDatabaseChanges(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, showNotice?: boolean, onlyNew?: boolean, forceWriteAll?: boolean, includeDeletion?: boolean): Promise<boolean>;
/**
 * Processes a single database file modification, resolving conflicts or updating the local storage.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param storageFilePath - The local file path.
 * @param reason - The log context string.
 * @param preventDoubleProcess - If true, skips processing if this database key revision matches the cache.
 * @param onlyNew - If true, only overwrites if database entries are newer.
 * @param metaEntry - Pre-fetched database metadata, if available.
 * @param includeDeletion - Whether to apply database deletions.
 * @returns True if database tracking succeeded.
 */
export declare function trackDatabaseFileModification(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, storageFilePath: FilePath, reason: string, preventDoubleProcess: boolean, onlyNew: boolean, metaEntry?: MetaEntry | LoadedEntry, includeDeletion?: boolean): Promise<boolean | undefined>;
/**
 * Event handler triggered when synchronised files change in the database.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param doc - The loaded database document entry.
 * @returns True if database change processing was handled; otherwise, false.
 */
export declare function processOptionalSyncFiles(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, doc: LoadedEntry): Promise<boolean>;
/**
 * Extracts and formats key metadata properties from a database document.
 *
 * @param host - The service feature host.
 * @param doc - The database document metadata or loaded entry.
 * @returns Formatted metadata property strings.
 */
export declare function getDocProps(host: HiddenFileSyncHost, doc: MetaEntry | LoadedEntry): {
    id: DocumentID;
    rev: string;
    revDisplay: string;
    prefixedPath: DocumentID;
    path: FilePath;
    isDeleted: boolean;
    shortenedId: string;
    shortenedPath: string;
};
/**
 * Extracts the numerical revision sequence prefix from a PouchDB revision string.
 *
 * @param rev - The PouchDB revision string.
 * @returns The numerical prefix string of the revision.
 */
export declare function displayRev(rev: string): string;
/**
 * Returns a callback wrapper that invokes the inner function only once every N invocations.
 *
 * @param n - The step frequency threshold.
 * @param func - The inner function callback.
 * @returns The step count logging wrapper function.
 */
export declare function onlyInNTimes(n: number, func: (progress: number) => void): () => void;
/**
 * Queues folder change notifications to warn the user about plugin or configuration updates.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @param key - The file path that was updated.
 */
export declare function queueNotification(host: HiddenFileSyncHost, state: HiddenFileSyncState, key: FilePath): void;
/**
 * Triggers user notifications and prompt dialogues for reloading plug-ins or reloading the Obsidian application.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 */
export declare function notifyConfigChange(host: HiddenFileSyncHost, state: HiddenFileSyncState): void;
/**
 * Temporarily suspends hidden file synchronisation settings during initial replications.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @returns True if setting change was applied.
 */
export declare function suspendExtraSync(host: HiddenFileSyncHost, state: HiddenFileSyncState): Promise<boolean>;
/**
 * Prompts the user with dialogue choices to configure hidden file synchronisation modes.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param opt - Configuration options specifying available modes.
 * @returns True if configuration completed.
 */
export declare function askUsingOptionalSyncFeature(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, opt: {
    enableFetch?: boolean;
    enableOverwrite?: boolean;
}): Promise<boolean>;
/**
 * Applies settings and initialises synchronisation based on the selected mode.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param feature - The selected configuration feature mode ('FETCH', 'OVERWRITE', 'MERGE', 'DISABLE', or 'DISABLE_HIDDEN').
 * @returns True if setting change was applied; otherwise, false.
 */
export declare function configureOptionalSyncFeature(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, feature: keyof any): Promise<boolean>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
