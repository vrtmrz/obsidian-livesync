import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type LOG_LEVEL,
    type MetaEntry,
    type UXFileInfo,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { addPrefix } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";

import { ICHeader } from "@/common/types.ts";
import type { HiddenFileSyncConflictResolution } from "./hiddenFileSyncConflictResolution.ts";
import type { HiddenFileSyncDatabaseExtractionOperations } from "./hiddenFileSyncDatabaseExtractionOperations.ts";
import type { HiddenFileSyncDatabaseWriteOperations } from "./hiddenFileSyncDatabaseWriteOperations.ts";
import type { HiddenFileSyncProcessedState } from "./hiddenFileSyncProcessedState.ts";
import { getHiddenFileSyncComparisonMTime } from "./hiddenFileSyncState.ts";
import { compareMTime, TARGET_IS_NEW } from "@/common/utils.ts";

type HiddenFileSyncStorageChangeAccess = Pick<StorageAccess, "statHidden">;

export type HiddenFileSyncChangeProcessorDependencies = {
    storageAccess: HiddenFileSyncStorageChangeAccess;
    readFileWithInfo(path: FilePath): Promise<UXFileInfo>;
    loadDatabaseMetadata(path: FilePathWithPrefix): Promise<MetaEntry | LoadedEntry | false>;
    databaseWriteOperations: Pick<HiddenFileSyncDatabaseWriteOperations, "store" | "delete">;
    databaseExtractionOperations: Pick<HiddenFileSyncDatabaseExtractionOperations, "extract">;
    processedState: Pick<
        HiddenFileSyncProcessedState,
        | "fileToStatKey"
        | "getLastProcessedFileKey"
        | "getLastProcessedFileMTime"
        | "updateLastProcessedFile"
        | "updateLastProcessed"
    >;
    conflictResolution: Pick<HiddenFileSyncConflictResolution, "queue">;
    log: LogFunction;
    publishActivity(eventCount: number, processingCount: number): void;
};

export type HiddenFileSyncDatabaseChangeOptions = Readonly<{
    preventDoubleProcess?: boolean;
    onlyNew?: boolean;
    metaEntry?: MetaEntry | false;
    includeDeletion?: boolean;
}>;

export type HiddenFileSyncChangeProcessor = {
    processStorageChange(
        path: FilePath,
        onlyNew?: boolean,
        forceWrite?: boolean,
        includeDeleted?: boolean
    ): Promise<boolean | undefined>;
    processDatabaseChange(
        path: FilePath,
        headerLine: string,
        options?: HiddenFileSyncDatabaseChangeOptions
    ): Promise<boolean>;
    dispose(): void;
};

class HiddenFileSyncChangeProcessorOwner implements HiddenFileSyncChangeProcessor {
    private readonly semaphore = Semaphore(10);
    private eventCount = 0;
    private processingCount = 0;
    private disposed = false;

    constructor(private readonly dependencies: HiddenFileSyncChangeProcessorDependencies) {}

    async processStorageChange(
        path: FilePath,
        onlyNew = false,
        forceWrite = false,
        includeDeleted = true
    ): Promise<boolean | undefined> {
        try {
            return await this.serialiseForEvent(path, async () => {
                let stat = await this.dependencies.storageAccess.statHidden(path);
                // Sometimes a folder is delivered as a file event.
                if (stat != null && stat.type != "file") {
                    return false;
                }
                const key = await this.dependencies.processedState.fileToStatKey(path, stat);
                // A raw event can occur while the file is being read. Scans
                // still enumerate every path, but event admission skips this
                // exact already-settled key.
                const lastKey = this.dependencies.processedState.getLastProcessedFileKey(path);
                if (lastKey == key) {
                    this.log(`${path} Already processed.`, LOG_LEVEL_DEBUG);
                    return true;
                }

                // Read the stat and content as one operation. The stat is
                // deliberately compared again below: a file can change while
                // the first stat is in flight.
                const fileInfo = await this.dependencies.readFileWithInfo(path);
                const cacheMTime = getHiddenFileSyncComparisonMTime(fileInfo.stat);
                const statMtime = getHiddenFileSyncComparisonMTime(stat);
                if (cacheMTime != statMtime) {
                    this.log(`Hidden file:${path} is changed.`, LOG_LEVEL_VERBOSE);
                    stat = fileInfo.stat;
                }

                // Compatibility: the storage marker advances before the
                // database operation. A later write failure can therefore
                // leave this event marked as processed until a scan or state
                // change causes it to be reconsidered.
                this.dependencies.processedState.updateLastProcessedFile(path, stat!);
                const lastIsNotFound = !lastKey || lastKey.endsWith("-0-0");
                const nowIsNotFound = fileInfo.deleted;
                const type = lastIsNotFound && nowIsNotFound ? "invalid" : nowIsNotFound ? "delete" : "modified";

                if (type == "invalid") {
                    // Maybe the folder was deleted.
                    return false;
                }

                const storageMTimeActual = getHiddenFileSyncComparisonMTime(stat);
                const storageMTime =
                    storageMTimeActual == 0
                        ? this.dependencies.processedState.getLastProcessedFileMTime(path)
                        : storageMTimeActual;

                if (onlyNew) {
                    const prefixedFileName = addPrefix(path, ICHeader);
                    const fileOnDatabase = await this.dependencies.loadDatabaseMetadata(prefixedFileName);
                    const databaseMTime = getHiddenFileSyncComparisonMTime(fileOnDatabase, includeDeleted);
                    const difference = compareMTime(storageMTime, databaseMTime);
                    if (difference != TARGET_IS_NEW) {
                        this.log(`Hidden file:${path} is not new.`, LOG_LEVEL_VERBOSE);
                        // OnlyNew does not handle a deletion. Preserve the
                        // inherited partial settlement when both values exist.
                        if (fileOnDatabase && stat) {
                            this.dependencies.processedState.updateLastProcessed(path, fileOnDatabase, stat);
                        }
                        return true;
                    }
                }

                if (type == "delete") {
                    this.log(`Deletion detected: ${path}`);
                    return await this.dependencies.databaseWriteOperations.delete(path, forceWrite);
                }
                if (type == "modified") {
                    this.log(`Modification detected:${path}`, LOG_LEVEL_VERBOSE);
                    const result = await this.dependencies.databaseWriteOperations.store(fileInfo, forceWrite);
                    const resultText = result === undefined ? "Nothing changed" : result ? "Updated" : "Failed";
                    this.log(`${resultText}: ${path} ${resultText}`, LOG_LEVEL_VERBOSE);
                    return result;
                }
                return false;
            });
        } catch (error) {
            this.log(`Failed to process hidden file:${path}`);
            this.log(error, LOG_LEVEL_VERBOSE);
        }
        // Could not be processed, but it was this operation's event. Return
        // true to prevent a later handler from claiming it.
        return true;
    }

    async processDatabaseChange(
        path: FilePath,
        headerLine: string,
        options: HiddenFileSyncDatabaseChangeOptions = {}
    ): Promise<boolean> {
        const {
            preventDoubleProcess = false,
            onlyNew = false,
            metaEntry = false,
            includeDeletion = true,
        } = options;
        return await this.serialiseForEvent(path, async () => {
            try {
                const prefixedPath = addPrefix(path, ICHeader);
                const docMeta = metaEntry
                    ? metaEntry
                    : await this.dependencies.loadDatabaseMetadata(prefixedPath);
                if (docMeta === false) {
                    this.log(`${headerLine}: Failed to read detail of ${path}`);
                    throw new Error(`Failed to read detail ${path}`);
                }
                if (docMeta._conflicts && docMeta._conflicts.length > 0) {
                    this.dependencies.conflictResolution.queue(path);
                    this.log(`${headerLine} Hidden file conflicted, enqueued to resolve`);
                    return true;
                }
                const extracted = await this.dependencies.databaseExtractionOperations.extract(path, {
                    metaEntry: docMeta,
                    preventDoubleProcess,
                    onlyNew,
                    includeDeletion,
                });
                if (extracted) {
                    this.log(`${headerLine} Hidden file processed`);
                }
            } catch (error) {
                this.log(`${headerLine} Failed to process hidden file`);
                this.log(error, LOG_LEVEL_VERBOSE);
            }
            // Compatibility: recognition consumes the database event even when
            // extraction returned false or threw. A later scan or state change,
            // rather than handler fall-through, is responsible for retrying it.
            return true;
        });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.eventCount = 0;
        this.processingCount = 0;
        this.publishActivity();
    }

    private async serialiseForEvent<Result>(file: FilePath, operation: () => Promise<Result>): Promise<Result> {
        this.eventCount++;
        this.publishActivity();
        const release = await this.semaphore.acquire();
        try {
            return await serialized(`hidden-file-event:${file}`, async () => {
                this.processingCount++;
                this.publishActivity();
                try {
                    return await operation();
                } finally {
                    this.processingCount = Math.max(0, this.processingCount - 1);
                    this.publishActivity();
                }
            });
        } finally {
            release();
            this.eventCount = Math.max(0, this.eventCount - 1);
            this.publishActivity();
        }
    }

    private publishActivity(): void {
        this.dependencies.publishActivity(
            this.disposed ? 0 : this.eventCount,
            this.disposed ? 0 : this.processingCount
        );
    }

    private log(message: unknown, level?: LOG_LEVEL, key?: string): void {
        this.dependencies.log(message, level, key);
    }
}

export function createHiddenFileSyncChangeProcessor(
    dependencies: HiddenFileSyncChangeProcessorDependencies
): HiddenFileSyncChangeProcessor {
    return new HiddenFileSyncChangeProcessorOwner(dependencies);
}
