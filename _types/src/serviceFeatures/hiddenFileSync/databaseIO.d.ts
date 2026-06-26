// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { UXFileInfo, UXStat, FilePath, UXDataWriteOptions, MetaEntry, LoadedEntry } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { InternalFileInfo } from "@/common/types.ts";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";
/**
 * Ensures that the directory structure for a given path exists in the storage.
 * If the directory does not exist, it will be created recursively.
 *
 * @param host - The service feature host providing access to services.
 * @param path - The file path for which the parent directories should be ensured.
 */
export declare function ensureDir(host: HiddenFileSyncHost, path: FilePath): Promise<void>;
/**
 * Writes data directly to a hidden storage file and returns the updated file metadata.
 *
 * @param host - The service feature host providing access to services.
 * @param path - The destination file path.
 * @param data - The text or binary data to be written.
 * @param opt - Optional metadata settings such as modification time and creation time.
 * @returns The metadata of the written file, or null if the write operation failed.
 */
export declare function writeFile(host: HiddenFileSyncHost, path: FilePath, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<UXStat | null>;
/**
 * Internal helper to remove a file from the hidden storage.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param path - The target file path to be removed.
 * @returns 'OK' if the file was successfully removed, 'ALREADY' if it did not exist, or false on failure.
 */
export declare function __removeFile(host: HiddenFileSyncHost, log: LogFunction, path: FilePath): Promise<"OK" | "ALREADY" | false>;
/**
 * Triggers a storage synchronisation event to notify other modules of a file modification.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param path - The modified file path.
 */
export declare function triggerEvent(host: HiddenFileSyncHost, log: LogFunction, path: FilePath): Promise<void>;
/**
 * Internal helper to delete a hidden file and trigger its respective event notifications.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param storageFilePath - The path of the file to be deleted.
 * @returns 'OK' if deleted, 'ALREADY' if not found, or false if the operation failed.
 */
export declare function __deleteFile(host: HiddenFileSyncHost, log: LogFunction, storageFilePath: FilePath): Promise<false | "OK" | "ALREADY">;
/**
 * Internal helper to check whether a storage file needs to be written by comparing its contents with target data.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param storageFilePath - The path of the storage file.
 * @param content - The target content to compare against.
 * @returns True if the contents differ or an error occurs; false if they are identical.
 */
export declare function __checkIsNeedToWriteFile(host: HiddenFileSyncHost, log: LogFunction, storageFilePath: FilePath, content: string | ArrayBuffer): Promise<boolean>;
/**
 * Internal helper to write a database entry back to a local storage file.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param storageFilePath - The path of the target file in the storage.
 * @param fileOnDB - The loaded database entry.
 * @param force - If true, writes the file regardless of content equivalence.
 * @returns The file metadata on success, or false on failure.
 */
export declare function __writeFile(host: HiddenFileSyncHost, log: LogFunction, storageFilePath: FilePath, fileOnDB: LoadedEntry, force: boolean): Promise<false | UXStat>;
/**
 * Loads a hidden file from local storage, wrapping it in a `UXFileInfo` structure.
 *
 * @param host - The service feature host providing access to services.
 * @param path - The local file path.
 * @returns A structure containing the file name, path, metadata, and body content.
 */
export declare function loadFileWithInfo(host: HiddenFileSyncHost, path: FilePath): Promise<UXFileInfo>;
/**
 * Internal helper to load the base database document entry for a given file.
 * Returns a template for a new entry if the file does not exist in the database.
 *
 * @param host - The service feature host providing access to services.
 * @param file - The target file path.
 * @param includeContent - Whether to load the content of the document.
 * @returns The loaded database entry.
 */
export declare function __loadBaseSaveData(host: HiddenFileSyncHost, file: FilePath, includeContent?: boolean): Promise<LoadedEntry | false>;
/**
 * Saves a local hidden file's content and metadata into the database.
 * Confirms that the file content has changed before submitting updates to save database storage.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The runtime file description containing metadata and body.
 * @param forceWrite - If true, saves the file to the database even if the content is identical.
 * @returns True if the update succeeded, undefined if skipped, or false on failure.
 */
export declare function storeInternalFileToDatabase(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, file: InternalFileInfo | UXFileInfo, forceWrite?: boolean): Promise<boolean | undefined>;
/**
 * Marks a hidden file as deleted in the database.
 * It also cleans up any conflicting revisions associated with the file.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param filenameSrc - The name of the file being deleted.
 * @param forceWrite - Unused parameter retained for interface compatibility.
 * @returns True if deletion succeeds, undefined if ignored, or false on error.
 */
export declare function deleteInternalFileOnDatabase(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, filenameSrc: FilePath, forceWrite?: boolean): Promise<boolean | undefined>;
/**
 * Extracts a hidden file's metadata and content from the database and writes it to local storage.
 * Evaluates whether writing is required based on timestamp differences, deletion markings, and conflict states.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param storageFilePath - The local file destination path.
 * @param force - If true, ignores cache check optimizations and forces the file to be written.
 * @param metaEntry - The pre-fetched metadata of the database document, if available.
 * @param preventDoubleProcess - If true, skips processing if this database key revision matches the cache.
 * @param onlyNew - If true, writes the file only when the database version has a newer modification time.
 * @param includeDeletion - Whether to apply deletion when checking newer times.
 * @param queueNotification - Optional callback to queue notification for reload events.
 * @returns True if processed successfully, undefined if skipped, or false on failure.
 */
export declare function extractInternalFileFromDatabase(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, storageFilePath: FilePath, force?: boolean, metaEntry?: MetaEntry | LoadedEntry, preventDoubleProcess?: boolean, onlyNew?: boolean, includeDeletion?: boolean, queueNotification?: (key: FilePath) => void): Promise<boolean | undefined>;
