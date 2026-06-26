import {
    type MetaEntry,
    type LoadedEntry,
    type UXFileInfo,
    type UXStat,
    type FilePath,
    LOG_LEVEL_VERBOSE,
} from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { addPrefix } from "@lib/string_and_binary/path.ts";
import { ICHeader } from "@/common/types.ts";
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
export function getComparingMTime(
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

/**
 * Converts a storage file stat object into a unique cache key representation.
 *
 * @param stat - The storage file metadata.
 * @returns A string key in the format: "mtime-size".
 */
export function statToKey(stat: UXStat | null) {
    return `${stat?.mtime ?? 0}-${stat?.size ?? 0}`;
}

/**
 * Converts a database document entry into a unique cache key representation.
 *
 * @param doc - The database document metadata or loaded entry.
 * @returns A string key representing mtime, size, revision, and deletion status.
 */
export function docToKey(doc: LoadedEntry | MetaEntry) {
    return `${doc.mtime}-${doc.size}-${doc._rev}-${doc._deleted || doc.deleted || false ? "-0" : "-1"}`;
}

/**
 * Calculates the storage metadata key for a given file path.
 *
 * @param host - The service feature host providing access to services.
 * @param file - The target file path.
 * @param stat - Pre-fetched metadata stat, if available.
 * @returns The calculated key string.
 */
export async function fileToStatKey(host: HiddenFileSyncHost, file: FilePath, stat: UXStat | null = null) {
    if (!stat) stat = await host.serviceModules.storageAccess.statHidden(file);
    return statToKey(stat);
}

/**
 * Updates the cached state for the last processed storage file metadata.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param keySrc - The metadata stat or key string representation to cache.
 */
export function updateLastProcessedFile(state: HiddenFileSyncState, file: FilePath, keySrc: string | UXStat) {
    const key = typeof keySrc == "string" ? keySrc : statToKey(keySrc);
    const splitted = key.split("-");
    if (splitted[0] != "0") {
        state._fileInfoLastKnown.set(file, Number(splitted[0]));
    }
    state._fileInfoLastProcessed.set(file, key);
}

/**
 * Fetches file stats from the storage and updates the cached state for the last processed file.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param stat - Pre-fetched metadata stat, if available.
 */
export async function updateLastProcessedAsActualFile(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    file: FilePath,
    stat?: UXStat | null
) {
    if (!stat) stat = await host.serviceModules.storageAccess.statHidden(file);
    state._fileInfoLastProcessed.set(file, statToKey(stat));
}

/**
 * Clears the last processed storage cache marks for target files or all files.
 *
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to clear all cached marks.
 */
export function resetLastProcessedFile(log: LogFunction, state: HiddenFileSyncState, targetFiles: FilePath[] | false) {
    if (targetFiles) {
        for (const key of targetFiles) {
            state._fileInfoLastProcessed.delete(key);
        }
    } else {
        log(`Delete all processed mark.`, LOG_LEVEL_VERBOSE);
        state._fileInfoLastProcessed.clear();
    }
}

/**
 * Retrieves the modification timestamp of the last processed storage file.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @returns The cached modification timestamp.
 */
export function getLastProcessedFileMTime(state: HiddenFileSyncState, file: FilePath) {
    const key = state._fileInfoLastKnown.get(file);
    if (!key) return 0;
    return key;
}

/**
 * Retrieves the cache key for the last processed storage file.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @returns The cached key string.
 */
export function getLastProcessedFileKey(state: HiddenFileSyncState, file: FilePath) {
    return state._fileInfoLastProcessed.get(file);
}

/**
 * Retrieves the cache key for the last processed database document.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @returns The cached key string.
 */
export function getLastProcessedDatabaseKey(state: HiddenFileSyncState, file: FilePath) {
    return state._databaseInfoLastProcessed.get(file);
}

/**
 * Updates the cached state for the last processed database document key.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param keySrc - The database document metadata or key representation to cache.
 */
export function updateLastProcessedDatabase(
    state: HiddenFileSyncState,
    file: FilePath,
    keySrc: string | MetaEntry | LoadedEntry
) {
    const key = typeof keySrc == "string" ? keySrc : docToKey(keySrc);
    state._databaseInfoLastProcessed.set(file, key);
}

/**
 * Updates both storage file and database cache records for a path, registering changes in the path manager.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The target file path.
 * @param db - The loaded database document entry.
 * @param stat - The storage metadata status.
 */
export function updateLastProcessed(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    path: FilePath,
    db: MetaEntry | LoadedEntry,
    stat: UXStat
) {
    updateLastProcessedDatabase(state, path, db);
    updateLastProcessedFile(state, path, statToKey(stat));
    const dbMTime = getComparingMTime(db);
    const storageMTime = getComparingMTime(stat);
    if (dbMTime == 0 || storageMTime == 0) {
        host.services.path.unmarkChanges(path);
    } else {
        host.services.path.markChangesAreSame(path, getComparingMTime(db), getComparingMTime(stat));
    }
}

/**
 * Updates both storage file and database cache records for a path to represent deletion, clearing path manager records.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The target file path.
 * @param db - The database entry representing deletion, or false if not stored.
 */
export function updateLastProcessedDeletion(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    path: FilePath,
    db: MetaEntry | LoadedEntry | false
) {
    host.services.path.unmarkChanges(path);
    if (db) updateLastProcessedDatabase(state, path, db);
    updateLastProcessedFile(state, path, statToKey(null));
}

/**
 * Fetches database document metadata and updates the database cache key for the path.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param file - The target file path.
 * @param doc - Optional pre-fetched metadata of the database document.
 */
export async function updateLastProcessedAsActualDatabase(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    file: FilePath,
    doc?: MetaEntry | LoadedEntry | null | false
) {
    const dbPath = addPrefix(file, ICHeader);
    if (!doc) doc = await host.services.database.localDatabase.getDBEntryMeta(dbPath);
    if (!doc) return;
    state._databaseInfoLastProcessed.set(file, docToKey(doc));
}

/**
 * Clears the last processed database cache marks for target files or all files.
 *
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to clear all cached marks.
 */
export function resetLastProcessedDatabase(
    log: LogFunction,
    state: HiddenFileSyncState,
    targetFiles: FilePath[] | false
) {
    if (targetFiles) {
        for (const key of targetFiles) {
            state._databaseInfoLastProcessed.delete(key);
        }
    } else {
        log(`Delete all processed mark.`, LOG_LEVEL_VERBOSE);
        state._databaseInfoLastProcessed.clear();
    }
}
