// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, MetaEntry } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";
/**
 * Adopts the current local storage files as already processed, updating their cache keys to match their actual current file states.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to adopt all local storage files.
 */
export declare function adoptCurrentStorageFilesAsProcessed(host: HiddenFileSyncHost, state: HiddenFileSyncState, targetFiles: FilePath[] | false): Promise<void>;
/**
 * Adopts the current database files as already processed, updating their cache keys to match their actual current database states.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to adopt all database files.
 */
export declare function adoptCurrentDatabaseFilesAsProcessed(host: HiddenFileSyncHost, state: HiddenFileSyncState, targetFiles: FilePath[] | false): Promise<void>;
/**
 * Compares and merges files between the storage and local database based on their modification timestamps.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param showNotice - Whether to show progress notifications.
 * @param targetFiles - A list of target files to merge, or false to merge all.
 * @returns A list of all file names processed during the merge.
 */
export declare function rebuildMerging(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, showNotice: boolean, targetFiles?: FilePath[] | false): Promise<FilePath[]>;
/**
 * Rebuilds database entries from the local storage files.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param showNotice - Whether to show progress notifications.
 * @param targetFiles - A list of target files, or false to process all files.
 * @param onlyNew - If true, only updates database records if they are newer than the storage version.
 * @returns A list of file paths processed.
 */
export declare function rebuildFromStorage(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, showNotice: boolean, targetFiles?: FilePath[] | false, onlyNew?: boolean): Promise<FilePath[]>;
/**
 * Rebuilds local storage files from the database entries.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param showNotice - Whether to show progress notifications.
 * @param targetFiles - A list of target files, or false to process all files.
 * @param onlyNew - If true, only overwrites local files if the database version is newer.
 * @returns A list of metadata entries processed.
 */
export declare function rebuildFromDatabase(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, showNotice: boolean, targetFiles?: FilePath[] | false, onlyNew?: boolean): Promise<MetaEntry[]>;
/**
 * Initialises or synchronises the hidden files synchronisation state based on a specified direction.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param direction - The direction of synchronisation ('pull', 'push', 'safe', 'pullForce', or 'pushForce').
 * @param showMessage - Whether to display progress status alerts in the UI.
 * @param targetFilesSrc - Specific source file paths to synchronise, or false for all.
 */
export declare function initialiseInternalFileSync(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, direction?: "pull" | "push" | "safe" | "pullForce" | "pushForce", showMessage?: boolean, targetFilesSrc?: string[] | false): Promise<void>;
