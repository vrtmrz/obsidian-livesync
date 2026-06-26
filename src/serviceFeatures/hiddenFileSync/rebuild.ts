import type { FilePath, FilePathWithPrefix, MetaEntry } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_INFO } from "@lib/common/types.ts";
import { compareMTime, getLogLevel, BASE_IS_NEW, TARGET_IS_NEW, EVEN } from "@/common/utils.ts";
import { stripAllPrefixes } from "@lib/string_and_binary/path.ts";

import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";

import {
    scanInternalFileNames,
    getAllDatabaseFiles,
    trackScannedStorageChanges,
    trackScannedDatabaseChange,
    scanAllStorageChanges,
    scanAllDatabaseChanges,
    getProgress,
    onlyInNTimes,
} from "./syncOperations.ts";

import {
    resetLastProcessedFile,
    resetLastProcessedDatabase,
    getComparingMTime,
    updateLastProcessedAsActualFile,
    updateLastProcessedAsActualDatabase,
} from "./stateHelpers.ts";

/**
 * Adopts the current local storage files as already processed, updating their cache keys to match their actual current file states.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to adopt all local storage files.
 */
export async function adoptCurrentStorageFilesAsProcessed(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    targetFiles: FilePath[] | false
) {
    const allFiles = await scanInternalFileNames(host, state);
    const files = targetFiles ? allFiles.filter((e) => targetFiles.some((t) => e.indexOf(t) !== -1)) : allFiles;
    for (const file of files) {
        await updateLastProcessedAsActualFile(host, state, file);
    }
}

/**
 * Adopts the current database files as already processed, updating their cache keys to match their actual current database states.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param targetFiles - A list of target files, or false to adopt all database files.
 */
export async function adoptCurrentDatabaseFilesAsProcessed(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    targetFiles: FilePath[] | false
) {
    const allFiles = await getAllDatabaseFiles(host, () => {}, state);
    const files = targetFiles ? allFiles.filter((e) => targetFiles.some((t) => e.path.indexOf(t) !== -1)) : allFiles;
    for (const file of files) {
        const path = stripAllPrefixes(host.services.path.getPath(file));
        await updateLastProcessedAsActualDatabase(host, state, path, file);
    }
}

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
export async function rebuildMerging(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    showNotice: boolean,
    targetFiles: FilePath[] | false = false
): Promise<FilePath[]> {
    const logLevel = getLogLevel(showNotice);
    const p = getProgress(log, state, "[⚙ Rebuild by Merge ]\n", logLevel);
    log(`Rebuilding hidden files from the storage and the local database.`, logLevel);
    p.log("Enumerating local files...");
    const currentStorageFilesAll = await scanInternalFileNames(host, state);
    const currentStorageFiles = targetFiles
        ? currentStorageFilesAll.filter((e) => targetFiles.some((f) => f == e))
        : currentStorageFilesAll;
    p.log("Enumerating database files...");
    const allDatabaseFiles = await getAllDatabaseFiles(host, log, state);
    const allDatabaseMap = new Map(allDatabaseFiles.map((e) => [stripAllPrefixes(host.services.path.getPath(e)), e]));
    const currentDatabaseFiles = targetFiles
        ? allDatabaseFiles.filter((e) => targetFiles.some((f) => f == stripAllPrefixes(host.services.path.getPath(e))))
        : allDatabaseFiles;

    const allFileNames = new Set([
        ...currentStorageFiles,
        ...currentDatabaseFiles.map((e) => stripAllPrefixes(host.services.path.getPath(e))),
    ]);
    const storageToDatabase = [] as FilePath[];
    const databaseToStorage = [] as MetaEntry[];

    const eachProgress = onlyInNTimes(100, (progress) => p.log(`Checking ${progress}/${allFileNames.size}`));
    for (const file of allFileNames) {
        eachProgress();
        const storageMTime = await host.serviceModules.storageAccess.statHidden(file);
        const mtimeStorage = getComparingMTime(storageMTime);
        const dbEntry = allDatabaseMap.get(file)!;
        const mtimeDB = getComparingMTime(dbEntry);
        const diff = compareMTime(mtimeStorage, mtimeDB);
        if (diff == BASE_IS_NEW) {
            storageToDatabase.push(file);
        } else if (diff == TARGET_IS_NEW) {
            databaseToStorage.push(dbEntry);
        } else if (diff == EVEN) {
            storageToDatabase.push(file);
        }
    }
    p.once(
        `Storage to Database: ${storageToDatabase.length} files\n Database to Storage: ${databaseToStorage.length} files`
    );
    resetLastProcessedDatabase(log, state, targetFiles);
    resetLastProcessedFile(log, state, targetFiles);
    const processes = [
        trackScannedStorageChanges(host, log, state, storageToDatabase, showNotice, false),
        trackScannedDatabaseChange(host, log, state, databaseToStorage, showNotice, false),
    ];
    p.log("Start processing...");
    await Promise.all(processes);
    p.done();
    return [...allFileNames];
}

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
export async function rebuildFromStorage(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    showNotice: boolean,
    targetFiles: FilePath[] | false = false,
    onlyNew = false
): Promise<FilePath[]> {
    const logLevel = getLogLevel(showNotice);
    log(`Rebuilding hidden files from the storage.`, logLevel);
    const p = getProgress(log, state, "[⚙ Rebuild by Storage ]\n", logLevel);
    p.log("Enumerating local files...");
    const currentFilesAll = await scanInternalFileNames(host, state);
    const currentFiles = targetFiles ? currentFilesAll.filter((e) => targetFiles.some((f) => f == e)) : currentFilesAll;
    p.once(`Storage to Database: ${currentFiles.length} files.`);
    p.log("Start processing...");
    resetLastProcessedFile(log, state, targetFiles);
    await trackScannedStorageChanges(host, log, state, currentFiles, showNotice, onlyNew);
    p.done();
    return currentFiles;
}

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
export async function rebuildFromDatabase(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    showNotice: boolean,
    targetFiles: FilePath[] | false = false,
    onlyNew = false
): Promise<MetaEntry[]> {
    const logLevel = getLogLevel(showNotice);
    const p = getProgress(log, state, "[⚙ Rebuild by Database ]\n", logLevel);
    p.log("Enumerating database files...");
    const allFiles = await getAllDatabaseFiles(host, log, state);

    const currentFiles = targetFiles
        ? allFiles.filter((e) => targetFiles.some((f) => f == stripAllPrefixes(host.services.path.getPath(e))))
        : allFiles;

    p.once(`Database to Storage: ${currentFiles.length} files.`);
    resetLastProcessedDatabase(log, state, targetFiles);
    p.log("Start processing...");
    await trackScannedDatabaseChange(host, log, state, currentFiles, showNotice, onlyNew);
    p.done();
    return currentFiles;
}

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
export async function initialiseInternalFileSync(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    direction: "pull" | "push" | "safe" | "pullForce" | "pushForce" = "safe",
    showMessage: boolean = false,
    targetFilesSrc: string[] | false = false
) {
    const logLevel = showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
    const p = getProgress(log, state, "[⚙ Initialise]\n", logLevel);
    p.log("Initialising hidden files sync...");

    const targetFiles = targetFilesSrc ? targetFilesSrc.map((e) => stripAllPrefixes(e as FilePathWithPrefix)) : false;
    if (direction == "pushForce" || direction == "push") {
        const onlyNew = direction == "push";
        p.log(`Started: Storage --> Database ${onlyNew ? "(Only New)" : ""}`);
        const updatedFiles = await rebuildFromStorage(host, log, state, showMessage, targetFiles, onlyNew);
        await adoptCurrentStorageFilesAsProcessed(host, state, updatedFiles);
        await adoptCurrentDatabaseFilesAsProcessed(host, state, updatedFiles);
        await scanAllStorageChanges(host, log, state, showMessage, true, false);
        await scanAllDatabaseChanges(host, log, state, showMessage, true, false);
    }
    if (direction == "pullForce" || direction == "pull") {
        const onlyNew = direction == "pull";
        p.log(`Started: Database --> Storage ${onlyNew ? "(Only New)" : ""}`);
        const updatedEntries = await rebuildFromDatabase(host, log, state, showMessage, targetFiles, onlyNew);
        const updatedFiles = updatedEntries.map((e) => stripAllPrefixes(host.services.path.getPath(e)));
        await adoptCurrentStorageFilesAsProcessed(host, state, updatedFiles);
        await adoptCurrentDatabaseFilesAsProcessed(host, state, updatedFiles);
        await scanAllDatabaseChanges(host, log, state, showMessage, true, false);
        await scanAllStorageChanges(host, log, state, showMessage, true, false);
    }
    if (direction == "safe") {
        p.log(`Started: Database <--> Storage (by modified date)`);
        const updatedFiles = await rebuildMerging(host, log, state, showMessage, targetFiles);
        await adoptCurrentStorageFilesAsProcessed(host, state, updatedFiles);
        await adoptCurrentDatabaseFilesAsProcessed(host, state, updatedFiles);
        await scanAllStorageChanges(host, log, state, showMessage, true, false);
        await scanAllDatabaseChanges(host, log, state, showMessage, true, false);
    }
    p.done();
}
