// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import type { FilePathWithPrefix } from "@lib/common/types.ts";
import type { CustomRegExp } from "@lib/common/utils.ts";
import type { MapLike } from "@/common/utils.ts";
/**
 * Represents the mutable runtime state for the hidden file synchronisation module.
 */
export interface HiddenFileSyncState {
    /** Processor for executing periodic internal/hidden file scanning. */
    periodicInternalFileScanProcessor: PeriodicProcessor | undefined;
    /** Map tracking the last processed file key for each local file path. */
    _fileInfoLastProcessed: MapLike<string, string>;
    /** Map tracking the last known modification timestamp for each local file path. */
    _fileInfoLastKnown: MapLike<string, number>;
    /** Map tracking the last processed database document key for each path. */
    _databaseInfoLastProcessed: MapLike<string, string>;
    /** Map tracking the last known database document timestamp for each path. */
    _databaseInfoLastKnown: MapLike<string, number>;
    /** Unused map for tracking deleted files. */
    _databaseInfoLastDeleted: Map<string, string>;
    /** Unused map for tracking deleted file timestamps. */
    _databaseInfoLastKnownDeleted: Map<string, number>;
    /** Semaphore to serialize operations on individual files and prevent race conditions. */
    semaphore: ReturnType<typeof Semaphore>;
    /** Set containing the prefix-marked document paths currently pending conflict checks. */
    pendingConflictChecks: Set<FilePathWithPrefix>;
    /** Processor executing the conflict resolution queue sequentially. */
    conflictResolutionProcessor: QueueProcessor<FilePathWithPrefix, void> | undefined;
    /** Cached regular expressions for file matching settings. */
    cacheFileRegExps: Map<string, CustomRegExp[][]>;
    /** Cached ignore file paths dictated by customisation sync. */
    cacheCustomisationSyncIgnoredFiles: Map<string, string[]>;
    /** Queued folder paths that have changed and require reload notification. */
    queuedNotificationFiles: Set<string>;
    /** Whether the synchronisation operations are temporarily suspended. */
    suspended: boolean;
    /** Notice count index for progress keys. */
    noticeIndex: number;
}
/**
 * Creates and initialises a new runtime state object for the hidden file synchronisation feature.
 *
 * @returns An initialised HiddenFileSyncState object.
 */
export declare function createHiddenFileSyncState(): HiddenFileSyncState;
