import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type LOG_LEVEL,
    type MetaEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { compareMTime, TARGET_IS_NEW } from "@/common/utils.ts";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { addPrefix } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

import { ICHeader } from "@/common/types.ts";
import { getHiddenFileSyncComparisonMTime } from "./hiddenFileSyncState.ts";
import type { HiddenFileSyncRemovalResult } from "./hiddenFileSyncStorage.ts";
import {
    serialiseHiddenFileOperation,
    type HiddenFileSyncFileSerialisationDependencies,
} from "./hiddenFileSyncFileOperations.ts";

export type HiddenFileSyncDatabaseExtractionOptions = Readonly<{
    force?: boolean;
    metaEntry?: MetaEntry | LoadedEntry;
    preventDoubleProcess?: boolean;
    onlyNew?: boolean;
    includeDeletion?: boolean;
    requiredLiveRevision?: string;
}>;

type HiddenFileSyncDatabaseExtractionStorageDependencies = {
    statStorageFile(path: FilePath): Promise<UXStat | null>;
    writeStorageFile(path: FilePath, entry: LoadedEntry, force: boolean): Promise<false | UXStat>;
    deleteStorageFile(path: FilePath): Promise<HiddenFileSyncRemovalResult>;
};

type HiddenFileSyncDatabaseExtractionReadDependencies = {
    loadDatabaseMetadata(path: FilePathWithPrefix): Promise<MetaEntry | LoadedEntry | false>;
    loadLiveRevision(path: FilePathWithPrefix, revision: string): Promise<MetaEntry | false>;
    loadDatabaseEntry(entry: MetaEntry | LoadedEntry): Promise<LoadedEntry | false>;
};

export type HiddenFileSyncDatabaseExtractionProcessedState = {
    databaseStateKey(entry: MetaEntry | LoadedEntry): string;
    getLastProcessedDatabaseKey(path: FilePath): string | undefined;
    getLastProcessedFileMTime(path: FilePath): number;
    updateLastProcessedDatabase(path: FilePath, entry: string | MetaEntry | LoadedEntry): void;
    updateLastProcessedFile(path: FilePath, storageFile: string | UXStat): void;
    updateLastProcessed(path: FilePath, databaseEntry: MetaEntry | LoadedEntry, storageFile: UXStat): void;
    updateLastProcessedDeletion(path: FilePath, databaseEntry: MetaEntry | LoadedEntry | false): void;
};

export type HiddenFileSyncDatabaseExtractionDependencies = HiddenFileSyncFileSerialisationDependencies &
    HiddenFileSyncDatabaseExtractionStorageDependencies &
    HiddenFileSyncDatabaseExtractionReadDependencies & {
        isIgnoredByIgnoreFile(path: string): Promise<boolean>;
        queueNotification(path: FilePath): void;
        processedState: HiddenFileSyncDatabaseExtractionProcessedState;
        log: LogFunction;
    };

export type HiddenFileSyncDatabaseExtractionOperations = {
    extract(path: FilePath, options?: HiddenFileSyncDatabaseExtractionOptions): Promise<boolean | undefined>;
    extractRevision(path: FilePath, revision: string, force?: boolean): Promise<boolean>;
};

function log(
    dependencies: Pick<HiddenFileSyncDatabaseExtractionDependencies, "log">,
    message: unknown,
    level?: LOG_LEVEL,
    key?: string
): void {
    dependencies.log(message, level, key);
}

export async function extractHiddenFileFromDatabase(
    dependencies: HiddenFileSyncDatabaseExtractionDependencies,
    storageFilePath: FilePath,
    options: HiddenFileSyncDatabaseExtractionOptions = {}
): Promise<boolean | undefined> {
    const {
        force = false,
        metaEntry,
        preventDoubleProcess = true,
        onlyNew = false,
        includeDeletion = true,
        requiredLiveRevision,
    } = options;
    const prefixedFileName = addPrefix(storageFilePath, ICHeader);
    // Compatibility: admission happens outside the per-file lock, so ignore
    // policy errors propagate instead of becoming a false extraction result.
    if (await dependencies.isIgnoredByIgnoreFile(storageFilePath)) {
        return undefined;
    }
    return await serialiseHiddenFileOperation(dependencies, prefixedFileName, async () => {
        try {
            // A caller-supplied Metadata entry is trusted as-is. It can change
            // before this lock is acquired; only exact-revision repair performs
            // an in-lock liveness check.
            const metaOnDatabase = requiredLiveRevision
                ? await dependencies.loadLiveRevision(prefixedFileName, requiredLiveRevision)
                : metaEntry
                  ? metaEntry
                  : await dependencies.loadDatabaseMetadata(prefixedFileName);
            // Compatibility: the exact-revision loader validates revision-tree
            // membership but normally returns a leaf without `_conflicts`.
            // Repair can therefore apply one live branch while ordinary
            // reflection remains blocked by conflicted winning Metadata.
            if (metaOnDatabase === false) {
                throw new Error(`File not found on database.:${storageFilePath}`);
            }
            if (metaOnDatabase._conflicts?.length) {
                log(
                    dependencies,
                    `Hidden file ${storageFilePath} has conflicted revisions, to keep in safe, writing to storage has been prevented`,
                    LOG_LEVEL_INFO
                );
                return false;
            }
            if (preventDoubleProcess) {
                const key = dependencies.processedState.databaseStateKey(metaOnDatabase);
                if (dependencies.processedState.getLastProcessedDatabaseKey(storageFilePath) == key && !force) {
                    // Compatibility question: the force suffix is unreachable
                    // because this branch is entered only when force is false.
                    log(
                        dependencies,
                        `STORAGE <-- DB: ${storageFilePath}: skipped (hidden, overwrite${force ? ", force" : ""}) (Previously processed)`
                    );
                    return undefined;
                }
            }
            if (onlyNew) {
                const databaseMTime = getHiddenFileSyncComparisonMTime(metaOnDatabase, includeDeletion);
                const storageStat = await dependencies.statStorageFile(storageFilePath);
                const storageMTimeActual = storageStat?.mtime ?? 0;
                const storageMTime =
                    storageMTimeActual == 0
                        ? dependencies.processedState.getLastProcessedFileMTime(storageFilePath)
                        : storageMTimeActual;
                const difference = compareMTime(storageMTime, databaseMTime);
                if (difference != TARGET_IS_NEW) {
                    log(
                        dependencies,
                        `STORAGE <-- DB: ${storageFilePath}: skipped (hidden, overwrite${force ? ", force" : ""}) (Not new)`
                    );
                    // Compatibility: a declined candidate is settled as
                    // processed, including a deletion excluded by
                    // includeDeletion. This prevents later scans retrying it.
                    dependencies.processedState.updateLastProcessedDatabase(storageFilePath, metaOnDatabase);
                    if (storageStat) dependencies.processedState.updateLastProcessedFile(storageFilePath, storageStat);
                    return undefined;
                }
            }
            const deleted = metaOnDatabase.deleted || metaOnDatabase._deleted || false;
            if (deleted) {
                const result = await dependencies.deleteStorageFile(storageFilePath);
                if (result == "OK") {
                    dependencies.processedState.updateLastProcessedDeletion(storageFilePath, metaOnDatabase);
                    return true;
                }
                if (result == "ALREADY") {
                    // Compatibility question: an already absent file updates
                    // only the database key. It does not record the missing
                    // storage key or call unmarkChanges through deletion state.
                    dependencies.processedState.updateLastProcessedDatabase(storageFilePath, metaOnDatabase);
                    return true;
                }
                return false;
            }

            const fileOnDatabase = await dependencies.loadDatabaseEntry(metaOnDatabase);
            if (fileOnDatabase === false) {
                throw new Error(`Failed to read file from database:${storageFilePath}`);
            }
            const resultStat = await dependencies.writeStorageFile(storageFilePath, fileOnDatabase, force);
            if (resultStat) {
                // Compatibility question: the storage writer also returns the
                // existing stat when content is unchanged. That no-op still
                // settles state and queues a configuration notification here.
                dependencies.processedState.updateLastProcessed(storageFilePath, metaOnDatabase, resultStat);
                dependencies.queueNotification(storageFilePath);
                log(
                    dependencies,
                    `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Done`
                );
                return true;
            }
            return false;
        } catch (error) {
            log(
                dependencies,
                `STORAGE <-- DB: ${storageFilePath}: written (hidden, overwrite${force ? ", force" : ""}) Failed`
            );
            log(dependencies, error, LOG_LEVEL_VERBOSE);
            return false;
        }
    });
}

export async function extractHiddenFileRevisionFromDatabase(
    dependencies: HiddenFileSyncDatabaseExtractionDependencies,
    storageFilePath: FilePath,
    revision: string,
    force = false
): Promise<boolean> {
    return Boolean(
        await extractHiddenFileFromDatabase(dependencies, storageFilePath, {
            force,
            requiredLiveRevision: revision,
        })
    );
}

export function createHiddenFileSyncDatabaseExtractionOperations(
    dependencies: HiddenFileSyncDatabaseExtractionDependencies
): HiddenFileSyncDatabaseExtractionOperations {
    return Object.freeze({
        extract: async (path, options) => await extractHiddenFileFromDatabase(dependencies, path, options),
        extractRevision: async (path, revision, force) =>
            await extractHiddenFileRevisionFromDatabase(dependencies, path, revision, force),
    });
}
