import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type LOG_LEVEL,
    type MetaEntry,
    type SavingEntry,
    type UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isDocContentSame, readAsBlob } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { addPrefix, stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

import type { InternalFileInfo } from "@/common/types.ts";
import { ICHeader } from "@/common/types.ts";
import {
    serialiseHiddenFileOperation,
    type HiddenFileSyncFileSerialisationDependencies,
    type HiddenFileSyncFileSerialiser,
} from "./hiddenFileSyncFileOperations.ts";

export type { HiddenFileSyncFileSerialiser } from "./hiddenFileSyncFileOperations.ts";

type HiddenFileSyncDatabaseWriteResponse = {
    readonly ok: boolean;
    readonly rev: string;
};

export type HiddenFileSyncDatabaseWriteProcessedState = {
    updateLastProcessed(path: FilePath, databaseEntry: MetaEntry | LoadedEntry, storageFile: UXFileInfo["stat"]): void;
    updateLastProcessedDeletion(path: FilePath, databaseEntry: MetaEntry | LoadedEntry | false): void;
};

export type HiddenFileSyncDatabaseWriteDependencies = {
    serialiseFileOperation: HiddenFileSyncFileSerialiser;
    isIgnoredByIgnoreFile(path: string): Promise<boolean>;
    readFileWithInfo(path: FilePath): Promise<UXFileInfo>;
    loadBaseEntry(path: FilePath): Promise<LoadedEntry | false>;
    loadBaseMetadata(path: FilePath): Promise<LoadedEntry | false>;
    loadLiveRevision(path: FilePathWithPrefix, revision: string): Promise<MetaEntry | false>;
    fetchEntryFromMeta(meta: MetaEntry, waitForReady: boolean, skipCheck: boolean): Promise<LoadedEntry | false>;
    storeWithBaseRevision(file: UXFileInfo, baseRevision: string, skipCheck: boolean): Promise<string | false>;
    putDatabaseEntry(entry: SavingEntry): Promise<false | HiddenFileSyncDatabaseWriteResponse>;
    putRaw(entry: LoadedEntry): Promise<HiddenFileSyncDatabaseWriteResponse>;
    removeRevision(id: LoadedEntry["_id"], revision: string): Promise<boolean>;
    processedState: HiddenFileSyncDatabaseWriteProcessedState;
    now(): number;
    log: LogFunction;
};

type HiddenFileSyncDatabaseWriteCommonDependencies = Pick<
    HiddenFileSyncDatabaseWriteDependencies,
    "isIgnoredByIgnoreFile" | "log" | "readFileWithInfo" | "serialiseFileOperation"
>;

export type StoreHiddenFileInDatabaseDependencies = HiddenFileSyncDatabaseWriteCommonDependencies &
    Pick<HiddenFileSyncDatabaseWriteDependencies, "loadBaseEntry" | "putDatabaseEntry" | "processedState">;

export type StoreHiddenFileWithBaseRevisionDependencies = HiddenFileSyncDatabaseWriteCommonDependencies &
    Pick<
        HiddenFileSyncDatabaseWriteDependencies,
        "fetchEntryFromMeta" | "loadLiveRevision" | "storeWithBaseRevision" | "processedState"
    >;

export type DeleteHiddenFileFromDatabaseDependencies = Pick<
    HiddenFileSyncDatabaseWriteDependencies,
    | "isIgnoredByIgnoreFile"
    | "loadBaseMetadata"
    | "log"
    | "now"
    | "putRaw"
    | "removeRevision"
    | "serialiseFileOperation"
    | "processedState"
>;

export type HiddenFileSyncDatabaseWriteOperations = {
    store(file: InternalFileInfo | UXFileInfo, forceWrite?: boolean): Promise<boolean | undefined>;
    storeWithBaseRevision(
        file: InternalFileInfo | UXFileInfo,
        baseRevision: string,
        createIfDifferent?: boolean
    ): Promise<boolean>;
    delete(path: FilePath, forceWrite?: boolean): Promise<boolean | undefined>;
};

type HiddenFileSyncDatabaseWriteGuardDependencies = HiddenFileSyncFileSerialisationDependencies &
    Pick<HiddenFileSyncDatabaseWriteDependencies, "log">;

function log(
    dependencies: Pick<HiddenFileSyncDatabaseWriteDependencies, "log">,
    message: unknown,
    level?: LOG_LEVEL,
    key?: string
) {
    dependencies.log(message, level, key);
}

async function runGuardedDatabaseWrite<Result>(
    dependencies: HiddenFileSyncDatabaseWriteGuardDependencies,
    prefixedFileName: FilePathWithPrefix,
    failureMessage: string,
    operation: () => Promise<Result>
): Promise<Result | false> {
    return await serialiseHiddenFileOperation(dependencies, prefixedFileName, async () => {
        try {
            return await operation();
        } catch (error) {
            log(dependencies, failureMessage);
            log(dependencies, error, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}

async function resolvePresentFileInfo(
    dependencies: Pick<HiddenFileSyncDatabaseWriteDependencies, "readFileWithInfo">,
    file: InternalFileInfo | UXFileInfo,
    storeFilePath: FilePath
): Promise<UXFileInfo> {
    const fileInfo = "stat" in file && "body" in file ? file : await dependencies.readFileWithInfo(storeFilePath);
    if (fileInfo.deleted) {
        throw new Error(`Hidden file:${storeFilePath} is deleted. This should not be occurred.`);
    }
    return fileInfo;
}

export async function storeHiddenFileInDatabase(
    dependencies: StoreHiddenFileInDatabaseDependencies,
    file: InternalFileInfo | UXFileInfo,
    forceWrite = false
): Promise<boolean | undefined> {
    const storeFilePath = stripAllPrefixes(file.path);
    const storageFilePath = file.path;
    // Compatibility: all three admission checks sit outside the guarded lock,
    // so policy errors propagate. The ordinary path reports an ignored file as
    // undefined, while the selected-revision path reports false.
    if (await dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
        return undefined;
    }
    const prefixedFileName = addPrefix(storeFilePath, ICHeader);

    return await runGuardedDatabaseWrite(
        dependencies,
        prefixedFileName,
        `STORAGE --> DB:${storageFilePath}: (hidden) Failed`,
        async () => {
            const fileInfo = await resolvePresentFileInfo(dependencies, file, storeFilePath);
            const baseData = await dependencies.loadBaseEntry(storeFilePath);
            if (baseData === false) throw new Error("Failed to load base data");
            if (baseData._rev && !forceWrite) {
                const isSame = await isDocContentSame(readAsBlob(baseData), fileInfo.body);
                if (isSame) {
                    dependencies.processedState.updateLastProcessed(storeFilePath, baseData, fileInfo.stat);
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
            // Compatibility question: ctime comes from the old database base,
            // not from the storage stat. A newly synthesised base therefore
            // stores ctime 0. Preserve this until cross-device effects are known.
            const ret = await dependencies.putDatabaseEntry(saveData);
            if (ret && ret.ok) {
                saveData._rev = ret.rev;
                dependencies.processedState.updateLastProcessed(storeFilePath, saveData, fileInfo.stat);
            }
            const success = ret && ret.ok;
            log(dependencies, `STORAGE --> DB:${storageFilePath}: (hidden) ${success ? "Done" : "Failed"}`);
            return success;
        }
    );
}

export async function storeHiddenFileWithBaseRevision(
    dependencies: StoreHiddenFileWithBaseRevisionDependencies,
    file: InternalFileInfo | UXFileInfo,
    baseRevision: string,
    createIfDifferent = true
): Promise<boolean> {
    const storeFilePath = stripAllPrefixes(file.path);
    const storageFilePath = file.path;
    if (await dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
        return false;
    }
    const prefixedFileName = addPrefix(storeFilePath, ICHeader);

    return await runGuardedDatabaseWrite(
        dependencies,
        prefixedFileName,
        `STORAGE --> DB:${storageFilePath}: (hidden, selected branch) Failed`,
        async () => {
            // The live check intentionally precedes the storage read. It avoids
            // work for a stale selection, but does not make the later write atomic.
            const baseData = await dependencies.loadLiveRevision(prefixedFileName, baseRevision);
            if (baseData === false) {
                return false;
            }
            const fileInfo = await resolvePresentFileInfo(dependencies, file, storeFilePath);
            if (!baseData.deleted && !baseData._deleted) {
                const loadedBase = await dependencies.fetchEntryFromMeta(baseData, true, true);
                if (loadedBase && (await isDocContentSame(readAsBlob(loadedBase), fileInfo.body))) {
                    dependencies.processedState.updateLastProcessed(storeFilePath, baseData, fileInfo.stat);
                    return true;
                }
            }
            if (!createIfDifferent) {
                log(
                    dependencies,
                    `Could not mark hidden file ${storeFilePath} as revision ${baseRevision}; the storage content differs`,
                    LOG_LEVEL_NOTICE
                );
                return false;
            }

            const storedRevision = await dependencies.storeWithBaseRevision(
                {
                    ...fileInfo,
                    path: storeFilePath,
                    name: fileInfo.name || storeFilePath.split("/").pop() || "",
                    isInternal: true,
                },
                baseRevision,
                true
            );
            if (storedRevision === false) {
                return false;
            }
            // Compatibility question: spreading a selected PouchDB tombstone
            // retains `_deleted: true` in the processed-state entry even though
            // `deleted` is reset. The stored child itself is created separately.
            dependencies.processedState.updateLastProcessed(
                storeFilePath,
                {
                    ...baseData,
                    _rev: storedRevision,
                    path: prefixedFileName,
                    ctime: fileInfo.stat.ctime,
                    mtime: fileInfo.stat.mtime,
                    size: fileInfo.stat.size,
                    deleted: false,
                },
                fileInfo.stat
            );
            log(dependencies, `STORAGE --> DB:${storageFilePath}: (hidden, selected branch) Done`);
            return true;
        }
    );
}

export async function deleteHiddenFileFromDatabase(
    dependencies: DeleteHiddenFileFromDatabaseDependencies,
    filenameSrc: FilePath,
    forceWrite = false
): Promise<boolean | undefined> {
    const storeFilePath = filenameSrc;
    const storageFilePath = filenameSrc;
    const displayFileName = filenameSrc;
    const prefixedFileName = addPrefix(storeFilePath, ICHeader);
    // Compatibility question: the timestamp is captured before the ignore
    // check and before waiting for the per-file lock.
    const mtime = dependencies.now();
    // Compatibility question: forceWrite is part of the inherited call
    // contract, but it has never changed deletion behaviour.
    void forceWrite;
    if (await dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
        return undefined;
    }
    return await runGuardedDatabaseWrite(
        dependencies,
        prefixedFileName,
        `STORAGE -x> DB: ${displayFileName}: (hidden) Failed`,
        async () => {
            const baseData = await dependencies.loadBaseMetadata(storeFilePath);
            if (baseData === false) throw new Error("Failed to load base data during deleting");
            if (baseData._conflicts !== undefined) {
                // Compatibility question: these removals are sequential but not
                // atomic. Earlier branches remain removed if a later call fails.
                for (const conflictRev of baseData._conflicts) {
                    await dependencies.removeRevision(baseData._id, conflictRev);
                    log(
                        dependencies,
                        `STORAGE -x> DB: ${displayFileName}: (hidden) conflict removed ${baseData._rev} =>  ${conflictRev}`,
                        LOG_LEVEL_VERBOSE
                    );
                }
            }
            // Compatibility question: only the domain `deleted` marker is
            // checked here. `_deleted: true` alone causes another tombstone write.
            if (baseData.deleted) {
                log(dependencies, `STORAGE -x> DB: ${displayFileName}: (hidden) already deleted`, LOG_LEVEL_VERBOSE);
                dependencies.processedState.updateLastProcessedDeletion(storeFilePath, baseData);
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
            // A synthesised base has no revision; the inherited behaviour still
            // writes it as a tombstone when the requested path was absent.
            const ret = await dependencies.putRaw(saveData);
            if (ret && ret.ok) {
                log(dependencies, `STORAGE -x> DB: ${displayFileName}: (hidden) Done`);
                saveData._rev = ret.rev;
                dependencies.processedState.updateLastProcessedDeletion(storeFilePath, saveData);
                return true;
            } else {
                log(dependencies, `STORAGE -x> DB: ${displayFileName}: (hidden) Failed`);
                return false;
            }
        }
    );
}

export function createHiddenFileSyncDatabaseWriteOperations(
    dependencies: HiddenFileSyncDatabaseWriteDependencies
): HiddenFileSyncDatabaseWriteOperations {
    return Object.freeze({
        store: async (file, forceWrite) => await storeHiddenFileInDatabase(dependencies, file, forceWrite),
        storeWithBaseRevision: async (file, baseRevision, createIfDifferent) =>
            await storeHiddenFileWithBaseRevision(dependencies, file, baseRevision, createIfDifferent),
        delete: async (path, forceWrite) => await deleteHiddenFileFromDatabase(dependencies, path, forceWrite),
    });
}
