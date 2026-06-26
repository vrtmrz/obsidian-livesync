import type { FilePath, LoadedEntry, MetaEntry, DocumentID } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import {
    MODE_SELECTIVE,
    MODE_PAUSED,
    LOG_LEVEL_VERBOSE,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_DEBUG,
} from "@lib/common/types.ts";
import { getFileRegExp, type CustomRegExp, fireAndForget } from "@lib/common/utils.ts";
import { compareMTime, getLogLevel, BASE_IS_NEW, TARGET_IS_NEW, EVEN, scheduleTask } from "@/common/utils.ts";
import { serialized, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { hiddenFilesEventCount, hiddenFilesProcessingCount } from "@lib/mock_and_interop/stores.ts";
import { addPrefix, stripAllPrefixes } from "@lib/string_and_binary/path.ts";
import { ICHeader, ICHeaderEnd } from "@/common/types.ts";
import { isInternalMetadata } from "@/common/utils.ts";
import { tryGetFilePath } from "@lib/common/utils.doc.ts";
import type { PluginManifest } from "@/deps.ts";
import { MARK_DONE } from "@/modules/features/ModuleLog.ts";

import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";

import {
    storeInternalFileToDatabase,
    deleteInternalFileOnDatabase,
    extractInternalFileFromDatabase,
    loadFileWithInfo,
} from "./databaseIO.ts";

import {
    getLastProcessedFileKey,
    statToKey,
    updateLastProcessedFile,
    getLastProcessedFileMTime,
    getComparingMTime,
    updateLastProcessed,
    docToKey,
    getLastProcessedDatabaseKey,
    fileToStatKey,
} from "./stateHelpers.ts";

import { initialiseInternalFileSync } from "./rebuild.ts";

// Helper for Progress
/**
 * Generates a progress logger that tracks long-running synchronisation operations.
 *
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param prefix - The message prefix to prepend to log statements.
 * @param level - The log level to use.
 * @returns An object containing `log`, `once`, and `done` progress log methods.
 */
export function getProgress(
    log: LogFunction,
    state: HiddenFileSyncState,
    prefix: string = "",
    level: any = LOG_LEVEL_NOTICE
) {
    const key = `keepalive-progress-${state.noticeIndex++}`;
    return {
        log: (msg: string) => {
            log(prefix + msg, level, key);
        },
        once: (msg: string) => {
            log(prefix + msg, level);
        },
        done: (msg: string = "Done") => {
            log(prefix + msg + MARK_DONE, level, key);
        },
    };
}

/**
 * Parses ignore and target custom regular expression filters from settings, caching the compiled filters.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @returns Compiled regular expressions for target and ignored files.
 */
export function parseRegExpSettings(host: HiddenFileSyncHost, state: HiddenFileSyncState) {
    const settings = host.services.setting.currentSettings();
    const regExpKey = `${settings.syncInternalFilesTargetPatterns}||${settings.syncInternalFilesIgnorePatterns}`;
    let ignoreFilter: CustomRegExp[];
    let targetFilter: CustomRegExp[];
    if (state.cacheFileRegExps.has(regExpKey)) {
        const cached = state.cacheFileRegExps.get(regExpKey)!;
        ignoreFilter = cached[1];
        targetFilter = cached[0];
    } else {
        ignoreFilter = getFileRegExp(settings, "syncInternalFilesIgnorePatterns");
        targetFilter = getFileRegExp(settings, "syncInternalFilesTargetPatterns");
        state.cacheFileRegExps.clear();
        state.cacheFileRegExps.set(regExpKey, [targetFilter, ignoreFilter]);
    }
    return { ignoreFilter, targetFilter };
}

/**
 * Checks if a given file path is matched by target patterns and not ignored by ignore patterns.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The file path to check.
 * @returns True if the path is a synchronisation target based on pattern settings; otherwise, false.
 */
export function isTargetFileInPatterns(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: string): boolean {
    const { ignoreFilter, targetFilter } = parseRegExpSettings(host, state);

    if (ignoreFilter && ignoreFilter.length > 0) {
        for (const pattern of ignoreFilter) {
            if (pattern.test(path)) {
                return false;
            }
        }
    }
    if (targetFilter && targetFilter.length > 0) {
        for (const pattern of targetFilter) {
            if (pattern.test(path)) {
                return true;
            }
        }
        return false;
    }
    return true;
}

/**
 * Determines which files are synchronised by the customisation sync feature and should be ignored by this module.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @returns A list of ignored file path strings.
 */
export function getCustomisationSynchronizationIgnoredFiles(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState
): string[] {
    const settings = host.services.setting.currentSettings();
    const configDir = host.services.API.getSystemConfigDir();
    const key = JSON.stringify(settings.pluginSyncExtendedSetting) + `||${settings.usePluginSync}||${configDir}`;
    if (state.cacheCustomisationSyncIgnoredFiles.has(key)) {
        return state.cacheCustomisationSyncIgnoredFiles.get(key)!;
    }
    state.cacheCustomisationSyncIgnoredFiles.clear();
    const synchronisedInConfigSync = !settings.usePluginSync
        ? []
        : Object.values(settings.pluginSyncExtendedSetting)
              .filter((e) => e.mode == MODE_SELECTIVE || e.mode == MODE_PAUSED)
              .map((e) => e.files)
              .flat()
              .map((e) => `${configDir}/${e}`.toLowerCase());
    state.cacheCustomisationSyncIgnoredFiles.set(key, synchronisedInConfigSync);
    return synchronisedInConfigSync;
}

/**
 * Checks whether a path is not ignored due to customisation synchronisation settings.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The file path to check.
 * @returns True if not ignored by customisation synchronisation; otherwise, false.
 */
export function isNotIgnoredByCustomisationSync(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    path: string
): boolean {
    const ignoredFiles = getCustomisationSynchronizationIgnoredFiles(host, state);
    const result = !ignoredFiles.some((e) => path.startsWith(e));
    return result;
}

/**
 * Verifies if the path represents a hidden configuration file.
 * Configuration files start with '.' and are not within the '.trash' folder.
 *
 * @param path - The file path to verify.
 * @returns True if the path represents a hidden file; otherwise, false.
 */
export function isHiddenFileSyncHandlingPath(path: FilePath): boolean {
    const result = path.startsWith(".") && !path.startsWith(".trash");
    return result;
}

/**
 * Validates if the path is a synchronisation target, checking pattern filters, customisation sync rules, hidden file rules, and ignore file rules.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param path - The target file path.
 * @returns True if the file should be synchronised; otherwise, false.
 */
export async function isTargetFile(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    path: FilePath
): Promise<boolean> {
    const result =
        isTargetFileInPatterns(host, state, path) &&
        isNotIgnoredByCustomisationSync(host, state, path) &&
        isHiddenFileSyncHandlingPath(path);
    if (!result) {
        return false;
    }
    const resultByFile = await host.services.vault.isIgnoredByIgnoreFile(path);
    return !resultByFile;
}

/**
 * Executes a function sequentially for an event using locks and semaphores to prevent race conditions during file processing.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @param file - The file path.
 * @param fn - The function to run.
 */
export async function serializedForEvent<T>(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    file: FilePath,
    fn: () => Promise<T>
) {
    hiddenFilesEventCount.value++;
    const rel = await state.semaphore.acquire();
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

/**
 * Recursively lists files inside the specified directory path that pass the verification check function.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @param path - The directory path to list.
 * @param checkFunction - The verification callback.
 * @returns A list of file paths.
 */
export async function getFiles(
    host: HiddenFileSyncHost,
    state: HiddenFileSyncState,
    path: string,
    checkFunction: (path: FilePath) => Promise<boolean> | boolean
): Promise<string[]> {
    let w: any;
    try {
        w = await host.context.app.vault.adapter.list(path);
    } catch (ex) {
        console.warn(`Could not traverse(HiddenSync):${path}`, ex);
        return [];
    }
    let files = [] as string[];
    for (const file of w.files) {
        if (!(await checkFunction(file as FilePath))) {
            continue;
        }
        files.push(file);
    }
    for (const v of w.folders) {
        if (!(await checkFunction(v as FilePath))) {
            continue;
        }
        files = files.concat(await getFiles(host, state, v, checkFunction));
    }
    return files;
}

/**
 * Scans the local workspace vault for hidden configuration files that are target synchronisation candidates.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @returns A list of hidden file paths.
 */
export async function scanInternalFileNames(host: HiddenFileSyncHost, state: HiddenFileSyncState): Promise<FilePath[]> {
    const root = host.context.app.vault.getRoot();
    const findRoot = root.path;
    const filenames = await getFiles(host, state, findRoot, (path) => isTargetFile(host, () => {}, state, path));
    return filenames as FilePath[];
}

/**
 * Queries the local database for all hidden configuration file metadata documents.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @returns A list of database metadata entries.
 */
export async function getAllDatabaseFiles(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState
): Promise<MetaEntry[]> {
    const allFiles = (
        await host.services.database.localDatabase.allDocsRaw({
            startkey: ICHeader,
            endkey: ICHeaderEnd,
            include_docs: true,
        })
    ).rows
        .filter((e) => isInternalMetadata(e.id as DocumentID))
        .map((e) => e.doc) as MetaEntry[];
    const files = [] as MetaEntry[];
    for (const file of allFiles) {
        const path = host.services.path.getPath(file);
        if (await isTargetFile(host, log, state, stripAllPrefixes(path))) {
            files.push(file);
        }
    }
    return files;
}

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
export async function trackScannedStorageChanges(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    processFiles: FilePath[],
    showNotice: boolean = false,
    onlyNew = false,
    forceWriteAll = false,
    includeDeleted = true
) {
    const logLevel = getLogLevel(showNotice);
    const p = getProgress(log, state, `[⚙ Storage -> DB ]\n`, logLevel);
    const notifyProgress = onlyInNTimes(100, (progress) => p.log(`${progress}/${processFiles.length}`));
    const processes = processFiles.map(async (file) => {
        try {
            await trackStorageFileModification(host, log, state, file, onlyNew, forceWriteAll, includeDeleted);
            notifyProgress();
        } catch (ex) {
            p.once(`Failed to process storage change file:${file}`);
            log(ex, LOG_LEVEL_VERBOSE);
        }
    });
    await Promise.all(processes);
    p.done();
}

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
export async function scanAllStorageChanges(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    showNotice: boolean = false,
    onlyNew = false,
    forceWriteAll = false,
    includeDeleted = true
): Promise<boolean> {
    const res = await skipIfDuplicated("scanAllStorageChanges", async () => {
        const logLevel = getLogLevel(showNotice);
        const p = getProgress(log, state, `[⚙ Scanning Storage -> DB ]\n`, logLevel);
        p.log(`Scanning storage files...`);
        const knownNames = [...state._fileInfoLastProcessed.keys()] as FilePath[];
        const existNames = await scanInternalFileNames(host, state);
        const files = new Set([...knownNames, ...existNames]);

        log(`Known/Exist ${knownNames.length}/${existNames.length}, Totally ${files.size} files.`, LOG_LEVEL_VERBOSE);
        const taskNameAndMeta = [...files].map(
            async (e) => [e, await host.serviceModules.storageAccess.statHidden(e)] as const
        );
        const nameAndMeta = await Promise.all(taskNameAndMeta);
        const processFiles = nameAndMeta
            .filter(([path, stat]) => {
                if (forceWriteAll) return true;
                const key = getLastProcessedFileKey(state, path);
                const newKey = statToKey(stat);
                return key != newKey;
            })
            .map(([path, stat]) => path);

        const staticsMessage = `[Storage hidden file statics]
Known files: ${knownNames.length}
Actual files: ${existNames.length}
All files: ${files.size}
Offline Changed files: ${processFiles.length}`;
        p.once(staticsMessage);
        await trackScannedStorageChanges(
            host,
            log,
            state,
            processFiles,
            showNotice,
            onlyNew,
            forceWriteAll,
            includeDeleted
        );
        p.done();
        return true;
    });
    return res ?? false;
}

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
export async function trackStorageFileModification(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    path: FilePath,
    onlyNew = false,
    forceWrite = false,
    includeDeleted = true
): Promise<boolean | undefined> {
    if (!(await isTargetFile(host, log, state, path))) {
        log(
            `Storage file tracking: Hidden file skipped: ${path} is filtered out by the defined patterns.`,
            LOG_LEVEL_VERBOSE
        );
        return false;
    }
    try {
        return await serializedForEvent(host, state, path, async () => {
            let stat = await host.serviceModules.storageAccess.statHidden(path);
            if (stat != null && stat.type != "file") {
                return false;
            }
            const key = await fileToStatKey(host, path, stat);
            const lastKey = getLastProcessedFileKey(state, path);
            if (lastKey == key) {
                log(`${path} Already processed.`, LOG_LEVEL_DEBUG);
                return true;
            }
            const cache = await loadFileWithInfo(host, path);
            const cacheMTime = getComparingMTime(cache.stat);
            const statMtime = getComparingMTime(stat);
            if (cacheMTime != statMtime) {
                log(`Hidden file:${path} is changed.`, LOG_LEVEL_VERBOSE);
                stat = cache.stat;
            }
            updateLastProcessedFile(state, path, stat!);
            const lastIsNotFound = !lastKey || lastKey.endsWith("-0-0");
            const nowIsNotFound = cache.deleted;
            const type = lastIsNotFound && nowIsNotFound ? "invalid" : nowIsNotFound ? "delete" : "modified";

            if (type == "invalid") {
                return false;
            }

            const storageMTimeActual = getComparingMTime(stat);
            const storageMTime = storageMTimeActual == 0 ? getLastProcessedFileMTime(state, path) : storageMTimeActual;

            if (onlyNew) {
                const prefixedFileName = addPrefix(path, ICHeader);
                const filesOnDB = await host.services.database.localDatabase.getDBEntryMeta(prefixedFileName);
                const dbMTime = getComparingMTime(filesOnDB, includeDeleted);
                const diff = compareMTime(storageMTime, dbMTime);

                if (diff != TARGET_IS_NEW) {
                    log(`Hidden file:${path} is not new.`, LOG_LEVEL_VERBOSE);
                    if (filesOnDB && stat) {
                        updateLastProcessed(host, state, path, filesOnDB, stat);
                    }
                    return true;
                }
            }

            if (type == "delete") {
                log(`Deletion detected: ${path}`);
                const result = await deleteInternalFileOnDatabase(host, log, state, path, forceWrite);
                return result;
            } else if (type == "modified") {
                log(`Modification detected:${path}`, LOG_LEVEL_VERBOSE);
                const result = await storeInternalFileToDatabase(host, log, state, cache, forceWrite);
                const resultText = result === undefined ? "Nothing changed" : result ? "Updated" : "Failed";
                log(`${resultText}: ${path} ${resultText}`, LOG_LEVEL_VERBOSE);
                return result;
            }
        });
    } catch (ex) {
        log(`Failed to process hidden file:${path}`);
        log(ex, LOG_LEVEL_VERBOSE);
    }
    return true;
}

/**
 * Applies offline database and storage modifications by comparing differences on untracked files.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param showNotice - Whether to show notifications.
 */
export async function applyOfflineChanges(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    showNotice: boolean
) {
    const logLevel = getLogLevel(showNotice);
    return await serialized("applyOfflineChanges", async () => {
        const p = getProgress(log, state, "[⚙ Apply untracked changes ]\n", logLevel);
        log(`Track changes.`, logLevel);
        p.log("Enumerating local files...");
        const currentStorageFiles = await scanInternalFileNames(host, state);
        p.log("Enumerating database files...");
        const currentDatabaseFiles = await getAllDatabaseFiles(host, log, state);
        const allDatabaseMap = Object.fromEntries(
            currentDatabaseFiles.map((e) => [stripAllPrefixes(host.services.path.getPath(e)), e])
        );
        const currentDatabaseFileNames = [...Object.keys(allDatabaseMap)] as FilePath[];
        const untrackedLocal = currentStorageFiles.filter((e) => !state._fileInfoLastProcessed.has(e));
        const untrackedDatabase = currentDatabaseFileNames.filter((e) => !state._databaseInfoLastProcessed.has(e));
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
                const fileStat = await host.serviceModules.storageAccess.statHidden(file);
                if (fileStat == null) {
                    log(`Unexpected error: Failed to stat file during applyOfflineChange :${file}`);
                    return;
                }
                const dbInfo = allDatabaseMap[file];
                if (dbInfo.deleted || dbInfo._deleted) {
                    return;
                }
                const fileMTime = getComparingMTime(fileStat);
                const dbMTime = getComparingMTime(dbInfo);
                const diff = compareMTime(fileMTime, dbMTime);
                if (diff == BASE_IS_NEW) {
                    await trackStorageFileModification(host, log, state, file, true);
                } else if (diff == TARGET_IS_NEW) {
                    await trackDatabaseFileModification(host, log, state, file, "[Apply]", true, true, dbInfo);
                } else if (diff == EVEN) {
                    updateLastProcessed(host, state, file, dbInfo, fileStat);
                }
            } finally {
                rel();
            }
        });
        await Promise.all(allProcesses);
        await scanAllStorageChanges(host, log, state, showNotice);
        await scanAllDatabaseChanges(host, log, state, showNotice);

        p.done();
    });
}

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
export async function trackScannedDatabaseChange(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    processFiles: MetaEntry[],
    showNotice: boolean = false,
    onlyNew = false,
    forceWriteAll = false,
    includeDeletion = true
) {
    const logLevel = getLogLevel(showNotice);
    const p = getProgress(log, state, `[⚙ DB -> Storage ]\n`, logLevel);
    const notifyProgress = onlyInNTimes(100, (progress) => p.log(`${progress}/${processFiles.length}`));
    const processes = processFiles.map(async (file) => {
        try {
            const path = stripAllPrefixes(host.services.path.getPath(file));
            if (!(await isTargetFile(host, log, state, path))) {
                log(
                    `Database file tracking: Hidden file skipped: ${path} is filtered out by the defined patterns.`,
                    LOG_LEVEL_VERBOSE
                );
            } else {
                await trackDatabaseFileModification(
                    host,
                    log,
                    state,
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
            log(`Failed to process storage change file:${tryGetFilePath(file)}`, logLevel);
            log(ex, LOG_LEVEL_VERBOSE);
        }
    });
    await Promise.all(processes);
    p.done();
}

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
export async function scanAllDatabaseChanges(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    showNotice: boolean = false,
    onlyNew = false,
    forceWriteAll = false,
    includeDeletion = true
): Promise<boolean> {
    const res = await skipIfDuplicated("scanAllDatabaseChanges", async () => {
        const databaseFiles = await getAllDatabaseFiles(host, log, state);
        const files = databaseFiles.filter((e) => {
            const doc = e;
            const key = docToKey(doc);
            const path = stripAllPrefixes(host.services.path.getPath(doc));
            const lastKey = getLastProcessedDatabaseKey(state, path);
            return lastKey != key;
        });
        const logLevel = getLogLevel(showNotice);
        const staticsMessage = `[Database hidden file statics]
All files: ${databaseFiles.length}
Offline Changed files: ${files.length}`;
        log(staticsMessage, logLevel, "scan-changes");
        await trackScannedDatabaseChange(host, log, state, files, showNotice, onlyNew, forceWriteAll, includeDeletion);
        return true;
    });
    return res ?? false;
}

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
export async function trackDatabaseFileModification(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    storageFilePath: FilePath,
    reason: string,
    preventDoubleProcess: boolean,
    onlyNew: boolean,
    metaEntry?: MetaEntry | LoadedEntry,
    includeDeletion = true
): Promise<boolean | undefined> {
    return await serializedForEvent(host, state, storageFilePath, async () => {
        try {
            const prefixedPath = addPrefix(storageFilePath, ICHeader);
            const docMeta = metaEntry
                ? metaEntry
                : await host.services.database.localDatabase.getDBEntryMeta(prefixedPath, { conflicts: true }, true);
            if (docMeta === false) {
                log(`${reason}: Failed to read detail of ${storageFilePath}`);
                throw new Error(`Failed to read detail ${storageFilePath}`);
            }
            if (docMeta._conflicts && docMeta._conflicts.length > 0) {
                if (state.conflictResolutionProcessor) {
                    state.conflictResolutionProcessor.enqueue(storageFilePath);
                }
                log(`${reason} Hidden file conflicted, enqueued to resolve`);
                return true;
            }
            const extractResult = await extractInternalFileFromDatabase(
                host,
                log,
                state,
                storageFilePath,
                false,
                docMeta,
                preventDoubleProcess,
                onlyNew,
                includeDeletion,
                (key) => queueNotification(host, state, key)
            );
            if (extractResult) {
                log(`${reason} Hidden file processed`);
            }
        } catch (ex) {
            log(`${reason} Failed to process hidden file`);
            log(ex, LOG_LEVEL_VERBOSE);
        }
        return true;
    });
}

/**
 * Event handler triggered when synchronised files change in the database.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param doc - The loaded database document entry.
 * @returns True if database change processing was handled; otherwise, false.
 */
export async function processOptionalSyncFiles(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    doc: LoadedEntry
): Promise<boolean> {
    if (isInternalMetadata(doc._id)) {
        const filename = host.services.path.getPath(doc);
        const unprefixedPath = stripAllPrefixes(filename);
        if (!(await isTargetFile(host, log, state, stripAllPrefixes(unprefixedPath)))) {
            log(`Skipped processing sync file:${unprefixedPath} (Not Hidden File Sync target)`, LOG_LEVEL_VERBOSE);
            return true;
        }
        const info = getDocProps(host, doc);
        const path = info.path;
        const headerLine = `Tracking DB ${info.path} (${info.revDisplay}) :`;
        const ret = await trackDatabaseFileModification(host, log, state, path, headerLine, false, false, doc);
        log(`${headerLine} Done: ${info.shortenedId})`, LOG_LEVEL_VERBOSE);
        return ret || false;
    }
    return false;
}

/**
 * Extracts and formats key metadata properties from a database document.
 *
 * @param host - The service feature host.
 * @param doc - The database document metadata or loaded entry.
 * @returns Formatted metadata property strings.
 */
export function getDocProps(host: HiddenFileSyncHost, doc: MetaEntry | LoadedEntry) {
    const path = stripAllPrefixes(host.services.path.getPath(doc));
    const id = doc._id;
    const rev = doc._rev ?? "";
    const shortenedId = id.substring(0, 10);
    const revDisplay = rev ? displayRev(rev) : "0-NOREVS";
    const shortenedPath = path.substring(0, 10);
    const isDeleted = doc._deleted || doc.deleted || false;
    return { id, rev, revDisplay, prefixedPath: doc._id, path, isDeleted, shortenedId, shortenedPath };
}

/**
 * Extracts the numerical revision sequence prefix from a PouchDB revision string.
 *
 * @param rev - The PouchDB revision string.
 * @returns The numerical prefix string of the revision.
 */
export function displayRev(rev: string) {
    return rev.split("-")[0];
}

/**
 * Returns a callback wrapper that invokes the inner function only once every N invocations.
 *
 * @param n - The step frequency threshold.
 * @param func - The inner function callback.
 * @returns The step count logging wrapper function.
 */
export function onlyInNTimes(n: number, func: (progress: number) => void) {
    let count = 0;
    return () => {
        count++;
        if (count % n == 0) {
            func(count);
        }
    };
}

/**
 * Queues folder change notifications to warn the user about plugin or configuration updates.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @param key - The file path that was updated.
 */
export function queueNotification(host: HiddenFileSyncHost, state: HiddenFileSyncState, key: FilePath) {
    const settings = host.services.setting.currentSettings();
    if (settings.suppressNotifyHiddenFilesChange) {
        return;
    }
    const configDir = host.services.API.getSystemConfigDir();
    if (!key.startsWith(configDir)) return;
    const dirName = key.split("/").slice(0, -1).join("/");
    state.queuedNotificationFiles.add(dirName);
    scheduleTask("notify-config-change", 1000, () => {
        notifyConfigChange(host, state);
    });
}

/**
 * Triggers user notifications and prompt dialogues for reloading plug-ins or reloading the Obsidian application.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 */
export function notifyConfigChange(host: HiddenFileSyncHost, state: HiddenFileSyncState) {
    const updatedFolders = [...state.queuedNotificationFiles];
    state.queuedNotificationFiles.clear();
    try {
        const manifests = Object.values((host.context.app as any).plugins.manifests) as unknown as PluginManifest[];
        const enabledPlugins = (host.context.app as any).plugins.enabledPlugins as Set<string>;
        const enabledPluginManifests = manifests.filter((e) => enabledPlugins.has(e.id));
        const modifiedManifests = enabledPluginManifests.filter((e) => updatedFolders.indexOf(e?.dir ?? "") >= 0);
        for (const manifest of modifiedManifests) {
            const updatePluginId = manifest.id;
            const updatePluginName = manifest.name;
            host.services.API.confirm.askInPopup(
                `updated-${updatePluginId}`,
                `Files in ${updatePluginName} has been updated!\nPress {HERE} to reload ${updatePluginName}, or press elsewhere to dismiss this message.`,
                (anchor) => {
                    anchor.text = "HERE";
                    anchor.addEventListener("click", () => {
                        fireAndForget(async () => {
                            console.log(`Unloading plugin: ${updatePluginName}`);
                            await (host.context.app as any).plugins.unloadPlugin(updatePluginId);
                            await (host.context.app as any).plugins.loadPlugin(updatePluginId);
                            console.log(`Plugin reloaded: ${updatePluginName}`);
                        });
                    });
                }
            );
        }
    } catch (ex) {
        console.warn("Error on checking plugin status.", ex);
    }

    if (updatedFolders.indexOf(host.services.API.getSystemConfigDir()) >= 0) {
        if (!host.services.appLifecycle.isReloadingScheduled()) {
            host.services.API.confirm.askInPopup(
                `updated-any-hidden`,
                `Some setting files have been modified\nPress {HERE} to schedule a reload of Obsidian, or press elsewhere to dismiss this message.`,
                (anchor) => {
                    anchor.text = "HERE";
                    anchor.addEventListener("click", () => {
                        host.services.appLifecycle.scheduleRestart();
                    });
                }
            );
        }
    }
}

/**
 * Temporarily suspends hidden file synchronisation settings during initial replications.
 *
 * @param host - The service feature host.
 * @param state - The runtime state.
 * @returns True if setting change was applied.
 */
export async function suspendExtraSync(host: HiddenFileSyncHost, state: HiddenFileSyncState): Promise<boolean> {
    if (host.services.setting.currentSettings().syncInternalFiles) {
        console.log(
            "Hidden file synchronization have been temporarily disabled. Please enable them after the fetching, if you need them."
        );
        await host.services.setting.applyPartial(
            {
                syncInternalFiles: false,
            },
            true
        );
    }
    return true;
}

/**
 * Prompts the user with dialogue choices to configure hidden file synchronisation modes.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param opt - Configuration options specifying available modes.
 * @returns True if configuration completed.
 */
export async function askUsingOptionalSyncFeature(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    opt: { enableFetch?: boolean; enableOverwrite?: boolean }
): Promise<boolean> {
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

    const ret = await host.services.API.confirm.confirmWithMessage(
        "Hidden file sync",
        message,
        choices,
        CHOICE_DISABLE,
        40
    );
    if (ret == CHOICE_FETCH) {
        await configureOptionalSyncFeature(host, log, state, "FETCH");
    } else if (ret == CHOICE_OVERWRITE) {
        await configureOptionalSyncFeature(host, log, state, "OVERWRITE");
    } else if (ret == CHOICE_MERGE) {
        await configureOptionalSyncFeature(host, log, state, "MERGE");
    } else if (ret == CHOICE_DISABLE) {
        await configureOptionalSyncFeature(host, log, state, "DISABLE_HIDDEN");
    }
    return true;
}

/**
 * Applies settings and initialises synchronisation based on the selected mode.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The runtime state.
 * @param feature - The selected configuration feature mode ('FETCH', 'OVERWRITE', 'MERGE', 'DISABLE', or 'DISABLE_HIDDEN').
 * @returns True if setting change was applied; otherwise, false.
 */
export async function configureOptionalSyncFeature(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    feature: keyof any
): Promise<boolean> {
    const mode = feature;
    if (mode != "FETCH" && mode != "OVERWRITE" && mode != "MERGE" && mode != "DISABLE" && mode != "DISABLE_HIDDEN") {
        return false;
    }

    if (mode == "DISABLE" || mode == "DISABLE_HIDDEN") {
        await host.services.setting.applyPartial(
            {
                syncInternalFiles: false,
            },
            true
        );
        return true;
    }
    log("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
    if (mode == "FETCH") {
        await initialiseInternalFileSync(host, log, state, "pullForce", true);
    } else if (mode == "OVERWRITE") {
        await initialiseInternalFileSync(host, log, state, "pushForce", true);
    } else if (mode == "MERGE") {
        await initialiseInternalFileSync(host, log, state, "safe", true);
    }
    await host.services.setting.applyPartial(
        {
            useAdvancedMode: true,
            syncInternalFiles: true,
        },
        true
    );
    return true;
}
