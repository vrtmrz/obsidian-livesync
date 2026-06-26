import type {
    UXFileInfo,
    UXStat,
    FilePath,
    UXDataWriteOptions,
    MetaEntry,
    LoadedEntry,
    SavingEntry,
    DocumentID,
} from "@lib/common/types.ts";
import { LOG_LEVEL_VERBOSE, LOG_LEVEL_DEBUG, LOG_LEVEL_INFO } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { InternalFileInfo } from "@/common/types.ts";
import { ICHeader } from "@/common/types.ts";
import { addPrefix, stripAllPrefixes } from "@lib/string_and_binary/path.ts";
import { isDocContentSame, readAsBlob, readContent, createBlob } from "@lib/common/utils.ts";
import { compareMTime, TARGET_IS_NEW } from "@/common/utils.ts";
import { serialized } from "octagonal-wheels/concurrency/lock";

import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";

import {
    getComparingMTime,
    updateLastProcessed,
    updateLastProcessedDeletion,
    updateLastProcessedFile,
    updateLastProcessedDatabase,
    getLastProcessedFileMTime,
    getLastProcessedDatabaseKey,
    docToKey,
} from "./stateHelpers.ts";

/**
 * Ensures that the directory structure for a given path exists in the storage.
 * If the directory does not exist, it will be created recursively.
 *
 * @param host - The service feature host providing access to services.
 * @param path - The file path for which the parent directories should be ensured.
 */
export async function ensureDir(host: HiddenFileSyncHost, path: FilePath) {
    const isExists = await host.serviceModules.storageAccess.isExistsIncludeHidden(path);
    if (!isExists) {
        await host.serviceModules.storageAccess.ensureDir(path);
    }
}

/**
 * Writes data directly to a hidden storage file and returns the updated file metadata.
 *
 * @param host - The service feature host providing access to services.
 * @param path - The destination file path.
 * @param data - The text or binary data to be written.
 * @param opt - Optional metadata settings such as modification time and creation time.
 * @returns The metadata of the written file, or null if the write operation failed.
 */
export async function writeFile(
    host: HiddenFileSyncHost,
    path: FilePath,
    data: string | ArrayBuffer,
    opt?: UXDataWriteOptions
): Promise<UXStat | null> {
    await host.serviceModules.storageAccess.writeHiddenFileAuto(path, data, opt);
    const stat = await host.serviceModules.storageAccess.statHidden(path);
    return stat;
}

/**
 * Internal helper to remove a file from the hidden storage.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param path - The target file path to be removed.
 * @returns 'OK' if the file was successfully removed, 'ALREADY' if it did not exist, or false on failure.
 */
export async function __removeFile(
    host: HiddenFileSyncHost,
    log: LogFunction,
    path: FilePath
): Promise<"OK" | "ALREADY" | false> {
    try {
        if (!(await host.serviceModules.storageAccess.isExistsIncludeHidden(path))) {
            return "ALREADY";
        }
        if (await host.serviceModules.storageAccess.removeHidden(path)) {
            return "OK";
        }
    } catch (ex) {
        log(`Failed to remove file:${path}`);
        log(ex, LOG_LEVEL_VERBOSE);
    }
    return false;
}

/**
 * Triggers a storage synchronisation event to notify other modules of a file modification.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param path - The modified file path.
 */
export async function triggerEvent(host: HiddenFileSyncHost, log: LogFunction, path: FilePath) {
    try {
        await host.serviceModules.storageAccess.triggerHiddenFile(path);
    } catch (ex) {
        log("Failed to call internal API(reconcileInternalFile)", LOG_LEVEL_VERBOSE);
        log(ex, LOG_LEVEL_VERBOSE);
    }
}

/**
 * Internal helper to delete a hidden file and trigger its respective event notifications.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param storageFilePath - The path of the file to be deleted.
 * @returns 'OK' if deleted, 'ALREADY' if not found, or false if the operation failed.
 */
export async function __deleteFile(
    host: HiddenFileSyncHost,
    log: LogFunction,
    storageFilePath: FilePath
): Promise<false | "OK" | "ALREADY"> {
    const result = await __removeFile(host, log, storageFilePath);
    if (result === false) {
        log(`STORAGE <x- DB: ${storageFilePath}: deleting (hidden) Failed`, LOG_LEVEL_VERBOSE);
        return false;
    }
    if (result === "OK") {
        await triggerEvent(host, log, storageFilePath);
    }
    log(`STORAGE <x- DB: ${storageFilePath}: deleting (hidden) ${result == "OK" ? "Done" : "Already not found"}`);
    return result;
}

/**
 * Internal helper to check whether a storage file needs to be written by comparing its contents with target data.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param storageFilePath - The path of the storage file.
 * @param content - The target content to compare against.
 * @returns True if the contents differ or an error occurs; false if they are identical.
 */
export async function __checkIsNeedToWriteFile(
    host: HiddenFileSyncHost,
    log: LogFunction,
    storageFilePath: FilePath,
    content: string | ArrayBuffer
): Promise<boolean> {
    try {
        const storageContent = await host.serviceModules.storageAccess.readHiddenFileAuto(storageFilePath);
        const needWrite = !(await isDocContentSame(storageContent, content));
        return needWrite;
    } catch (ex) {
        log(`Cannot check the content of ${storageFilePath}`, LOG_LEVEL_VERBOSE);
        log(ex, LOG_LEVEL_VERBOSE);
        return true;
    }
}

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
export async function __writeFile(
    host: HiddenFileSyncHost,
    log: LogFunction,
    storageFilePath: FilePath,
    fileOnDB: LoadedEntry,
    force: boolean
): Promise<false | UXStat> {
    try {
        const statBefore = await host.serviceModules.storageAccess.statHidden(storageFilePath);
        const isExist = statBefore != null;
        const writeContent = readContent(fileOnDB);
        await ensureDir(host, storageFilePath);

        const needWrite =
            force ||
            !isExist ||
            (isExist && (await __checkIsNeedToWriteFile(host, log, storageFilePath, writeContent)));

        if (!needWrite) {
            log(`STORAGE <-- DB: ${storageFilePath}: skipped (hidden) Not changed`, LOG_LEVEL_DEBUG);
            return statBefore;
        }

        const writeResultStat = await writeFile(host, storageFilePath, writeContent, {
            mtime: fileOnDB.mtime,
            ctime: fileOnDB.ctime,
        });

        if (writeResultStat == null) {
            log(
                `STORAGE <-- DB: ${storageFilePath}: written (hidden,new${force ? ", force" : ""}) Failed (writeResult)`
            );
            return false;
        }
        log(`STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""})`);
        return writeResultStat;
    } catch (ex) {
        log(
            `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Failed`,
            LOG_LEVEL_VERBOSE
        );
        log(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
}

/**
 * Loads a hidden file from local storage, wrapping it in a `UXFileInfo` structure.
 *
 * @param host - The service feature host providing access to services.
 * @param path - The local file path.
 * @returns A structure containing the file name, path, metadata, and body content.
 */
export async function loadFileWithInfo(host: HiddenFileSyncHost, path: FilePath): Promise<UXFileInfo> {
    const stat = await host.serviceModules.storageAccess.statHidden(path);
    if (!stat)
        return {
            name: path.split("/").pop() ?? "",
            path,
            stat: { size: 0, mtime: 0, ctime: 0, type: "file" },
            isInternal: true,
            deleted: true,
            body: createBlob(new Uint8Array(0)),
        };
    const content = await host.serviceModules.storageAccess.readHiddenFileAuto(path);
    return {
        name: path.split("/").pop() ?? "",
        path,
        stat,
        isInternal: true,
        deleted: false,
        body: createBlob(content),
    };
}

/**
 * Internal helper to load the base database document entry for a given file.
 * Returns a template for a new entry if the file does not exist in the database.
 *
 * @param host - The service feature host providing access to services.
 * @param file - The target file path.
 * @param includeContent - Whether to load the content of the document.
 * @returns The loaded database entry.
 */
export async function __loadBaseSaveData(
    host: HiddenFileSyncHost,
    file: FilePath,
    includeContent = true
): Promise<LoadedEntry | false> {
    const dbPath = addPrefix(file, ICHeader);
    const oldFile = await host.services.database.localDatabase.getDBEntry(
        dbPath,
        { conflicts: true },
        false,
        includeContent
    );
    if (oldFile === false) {
        return {
            _id: dbPath as any as DocumentID,
            path: dbPath,
            mtime: 0,
            ctime: new Date().getTime(),
            size: 0,
            children: [],
            deleted: false,
            type: "newnote",
            datatype: "newnote",
            data: "",
            eden: {},
        };
    }
    return oldFile;
}

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
export async function storeInternalFileToDatabase(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    file: InternalFileInfo | UXFileInfo,
    forceWrite = false
) {
    const storeFilePath = stripAllPrefixes(file.path);
    const storageFilePath = file.path;
    if (await host.services.vault.isIgnoredByIgnoreFile(storageFilePath)) {
        return undefined;
    }
    const prefixedFileName = addPrefix(storeFilePath, ICHeader);

    return await serialized("file-" + prefixedFileName, async () => {
        try {
            const fileInfo = "stat" in file && "body" in file ? file : await loadFileWithInfo(host, storeFilePath);
            if (fileInfo.deleted) {
                throw new Error(`Hidden file:${storeFilePath} is deleted. This should not be occurred.`);
            }
            const baseData = await __loadBaseSaveData(host, storeFilePath, true);
            if (baseData === false) throw new Error("Failed to load base data");
            if (baseData._rev && !forceWrite) {
                const isSame = await isDocContentSame(readAsBlob(baseData), fileInfo.body);
                if (isSame) {
                    updateLastProcessed(host, state, storeFilePath, baseData, fileInfo.stat);
                    return undefined;
                }
            }
            const saveData: SavingEntry = {
                ...baseData,
                data: fileInfo.body,
                mtime: fileInfo.stat.mtime,
                size: fileInfo.stat.size,
                children: [],
                deleted: false,
                type: baseData.datatype,
            };
            const ret = await host.services.database.localDatabase.putDBEntry(saveData);
            if (ret && ret.ok) {
                saveData._rev = ret.rev;
                updateLastProcessed(host, state, storeFilePath, saveData, fileInfo.stat);
            }
            const success = ret && ret.ok;
            log(`STORAGE --> DB:${storageFilePath}: (hidden) ${success ? "Done" : "Failed"}`);
            return success;
        } catch (ex) {
            log(`STORAGE --> DB:${storageFilePath}: (hidden) Failed`, LOG_LEVEL_VERBOSE);
            log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}

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
export async function deleteInternalFileOnDatabase(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    filenameSrc: FilePath,
    forceWrite = false
) {
    const storeFilePath = filenameSrc;
    const storageFilePath = filenameSrc;
    const displayFileName = filenameSrc;
    const prefixedFileName = addPrefix(storeFilePath, ICHeader);
    const mtime = new Date().getTime();
    if (await host.services.vault.isIgnoredByIgnoreFile(storageFilePath)) {
        return undefined;
    }
    return await serialized("file-" + prefixedFileName, async () => {
        try {
            const baseData = await __loadBaseSaveData(host, storeFilePath, false);
            if (baseData === false) throw new Error("Failed to load base data during deleting");
            if (baseData._conflicts !== undefined) {
                for (const conflictRev of baseData._conflicts) {
                    await host.services.database.localDatabase.removeRevision(baseData._id, conflictRev);
                    log(
                        `STORAGE -x> DB: ${displayFileName}: (hidden) conflict removed ${baseData._rev} =>  ${conflictRev}`,
                        LOG_LEVEL_VERBOSE
                    );
                }
            }
            if (baseData.deleted) {
                log(`STORAGE -x> DB: ${displayFileName}: (hidden) already deleted`, LOG_LEVEL_VERBOSE);
                updateLastProcessedDeletion(host, state, storeFilePath, baseData);
                return true;
            }
            const saveData: LoadedEntry = {
                ...baseData,
                mtime,
                size: 0,
                children: [],
                deleted: true,
                type: baseData.datatype,
            };
            const ret = await host.services.database.localDatabase.putRaw(saveData);
            if (ret && ret.ok) {
                log(`STORAGE -x> DB: ${displayFileName}: (hidden) Done`);
                saveData._rev = ret.rev;
                updateLastProcessedDeletion(host, state, storeFilePath, saveData);
                return true;
            } else {
                log(`STORAGE -x> DB: ${displayFileName}: (hidden) Failed`);
                return false;
            }
        } catch (ex) {
            log(`STORAGE -x> DB: ${displayFileName}: (hidden) Failed`, LOG_LEVEL_VERBOSE);
            log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}

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
export async function extractInternalFileFromDatabase(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    storageFilePath: FilePath,
    force = false,
    metaEntry?: MetaEntry | LoadedEntry,
    preventDoubleProcess = true,
    onlyNew = false,
    includeDeletion = true,
    queueNotification?: (key: FilePath) => void
) {
    const prefixedFileName = addPrefix(storageFilePath, ICHeader);
    if (await host.services.vault.isIgnoredByIgnoreFile(storageFilePath)) {
        return undefined;
    }
    return await serialized("file-" + prefixedFileName, async () => {
        try {
            const metaOnDB = metaEntry
                ? metaEntry
                : await host.services.database.localDatabase.getDBEntryMeta(
                      prefixedFileName,
                      { conflicts: true },
                      true
                  );
            if (metaOnDB === false) throw new Error(`File not found on database.:${storageFilePath}`);
            if (metaOnDB?._conflicts?.length) {
                log(
                    `Hidden file ${storageFilePath} has conflicted revisions, to keep in safe, writing to storage has been prevented`,
                    LOG_LEVEL_INFO
                );
                return false;
            }
            if (preventDoubleProcess) {
                const key = docToKey(metaOnDB);
                if (getLastProcessedDatabaseKey(state, storageFilePath) == key && !force) {
                    log(
                        `STORAGE <-- DB: ${storageFilePath}: skipped (hidden, overwrite${force ? ", force" : ""}) (Previously processed)`
                    );
                    return;
                }
            }
            if (onlyNew) {
                const dbMTime = getComparingMTime(metaOnDB, includeDeletion);
                const storageStat = await host.serviceModules.storageAccess.statHidden(storageFilePath);
                const storageMTimeActual = storageStat?.mtime ?? 0;
                const storageMTime =
                    storageMTimeActual == 0 ? getLastProcessedFileMTime(state, storageFilePath) : storageMTimeActual;
                const diff = compareMTime(storageMTime, dbMTime);
                if (diff != TARGET_IS_NEW) {
                    log(
                        `STORAGE <-- DB: ${storageFilePath}: skipped (hidden, overwrite${force ? ", force" : ""}) (Not new)`
                    );
                    updateLastProcessedDatabase(state, storageFilePath, metaOnDB);
                    if (storageStat) updateLastProcessedFile(state, storageFilePath, storageStat);
                    return;
                }
            }
            const deleted = metaOnDB.deleted || metaOnDB._deleted || false;
            if (deleted) {
                const result = await __deleteFile(host, log, storageFilePath);
                if (result == "OK") {
                    updateLastProcessedDeletion(host, state, storageFilePath, metaOnDB);
                    return true;
                } else if (result == "ALREADY") {
                    updateLastProcessedDatabase(state, storageFilePath, metaOnDB);
                    return true;
                }
                return false;
            } else {
                const fileOnDB = await host.services.database.localDatabase.getDBEntryFromMeta(metaOnDB, false, true);
                if (fileOnDB === false) {
                    throw new Error(`Failed to read file from database:${storageFilePath}`);
                }
                const resultStat = await __writeFile(host, log, storageFilePath, fileOnDB, force);
                if (resultStat) {
                    updateLastProcessed(host, state, storageFilePath, metaOnDB, resultStat);
                    queueNotification?.(storageFilePath);
                    log(
                        `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Done`
                    );
                    return true;
                }
            }
            return false;
        } catch (ex) {
            log(
                `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Failed`,
                LOG_LEVEL_VERBOSE
            );
            log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}
