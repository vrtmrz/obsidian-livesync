// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type MetaEntry, type LoadedEntry, type UXFileInfo, type UXStat, type FilePath } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";
/**
 * Extracts the modification timestamp (mtime) from various entry types for comparison.
 * If the entry represents a deleted file, it returns 0 unless `includeDeleted` is true.
 *
 * @param doc - The document entry or file info stat.
 * @param includeDeleted - Whether to return mtime for deleted entries.
 * @returns The modification timestamp, or 0 if empty or deleted.
 */
export declare function getComparingMTime(doc: (MetaEntry | LoadedEntry | false) | UXFileInfo | UXStat | null | undefined, includeDeleted?: boolean): number;
/**
 * Converts a storage file stat object into a unique cache key representation.
 *
 * @param stat - The storage file metadata.
 * @returns A string key in the format: "mtime-size".
 */
export declare function statToKey(stat: UXStat | null): string;
/**
 * Converts a database document entry into a unique cache key representation.
 *
 * @param doc - The database document metadata or loaded entry.
 * @returns A string key representing mtime, size, revision, and deletion status.
 */
export declare function docToKey(doc: LoadedEntry | MetaEntry): string;
/**
 * Calculates the storage metadata key for a given file path.
 *
 * @param host - The service feature host providing access to services.
 * @param file - The target file path.
 * @param stat - Pre-fetched metadata stat, if available.
 * @returns The calculated key string.
 */
export declare function fileToStatKey(host: HiddenFileSyncHost, file: FilePath, stat?: UXStat | null): Promise<string>;
/**
 * Updates the cached state for the last processed storage file metadata.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param keySrc - The metadata stat or key string representation to cache.
 */
export declare function updateLastProcessedFile(state: HiddenFileSyncState, file: FilePath, keySrc: string | UXStat): void;
/**
 * Fetches file stats from the storage and updates the cached state for the last processed file.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param stat - Pre-fetched metadata stat, if available.
 */
export declare function updateLastProcessedAsActualFile(host: HiddenFileSyncHost, state: HiddenFileSyncState, file: FilePath, stat?: UXStat | null): Promise<void>;
/**
 * Clears the last processed storage cache marks for target files or all files.
 *
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to clear all cached marks.
 */
export declare function resetLastProcessedFile(log: LogFunction, state: HiddenFileSyncState, targetFiles: FilePath[] | false): void;
/**
 * Retrieves the modification timestamp of the last processed storage file.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @returns The cached modification timestamp.
 */
export declare function getLastProcessedFileMTime(state: HiddenFileSyncState, file: FilePath): number;
/**
 * Retrieves the cache key for the last processed storage file.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @returns The cached key string.
 */
export declare function getLastProcessedFileKey(state: HiddenFileSyncState, file: FilePath): string | undefined;
/**
 * Retrieves the cache key for the last processed database document.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @returns The cached key string.
 */
export declare function getLastProcessedDatabaseKey(state: HiddenFileSyncState, file: FilePath): string | undefined;
/**
 * Updates the cached state for the last processed database document key.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param keySrc - The database document metadata or key representation to cache.
 */
export declare function updateLastProcessedDatabase(state: HiddenFileSyncState, file: FilePath, keySrc: string | MetaEntry | LoadedEntry): void;
/**
 * Updates both storage file and database cache records for a path, registering changes in the path manager.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The target file path.
 * @param db - The loaded database document entry.
 * @param stat - The storage metadata status.
 */
export declare function updateLastProcessed(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: FilePath, db: MetaEntry | LoadedEntry, stat: UXStat): void;
/**
 * Updates both storage file and database cache records for a path to represent deletion, clearing path manager records.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The target file path.
 * @param db - The database entry representing deletion, or false if not stored.
 */
export declare function updateLastProcessedDeletion(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: FilePath, db: MetaEntry | LoadedEntry | false): void;
/**
 * Fetches database document metadata and updates the database cache key for the path.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param doc - Optional pre-fetched metadata of the database document.
 */
export declare function updateLastProcessedAsActualDatabase(host: HiddenFileSyncHost, state: HiddenFileSyncState, file: FilePath, doc?: MetaEntry | LoadedEntry | null | false): Promise<void>;
/**
 * Clears the last processed database cache marks for target files or all files.
 *
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to clear all cached marks.
 */
export declare function resetLastProcessedDatabase(log: LogFunction, state: HiddenFileSyncState, targetFiles: FilePath[] | false): void;
