// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type { FilePathWithPrefix, LoadedEntry, MetaEntry, DocumentID } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";
/**
 * Enqueues a file path for a conflict check if it is not already pending.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The prefix-marked document path.
 */
export declare function queueConflictCheck(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: FilePathWithPrefix): void;
/**
 * Marks a conflict check as finished by removing the path from the pending conflicts set.
 *
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The prefix-marked document path.
 */
export declare function finishConflictCheck(state: HiddenFileSyncState, path: FilePathWithPrefix): void;
/**
 * Re-enqueues a file path for conflict check processing, clearing the previous state first.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param path - The prefix-marked document path.
 */
export declare function requeueConflictCheck(host: HiddenFileSyncHost, state: HiddenFileSyncState, path: FilePathWithPrefix): void;
/**
 * Scans the database for any conflicted hidden file entries and enqueues them for resolution.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 */
export declare function resolveConflictOnInternalFiles(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState): Promise<void>;
/**
 * Resolves a conflict automatically by keeping the revision with the newer modification timestamp and removing the older one.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param id - The Document ID in the database.
 * @param path - The prefix-marked file path.
 * @param currentDoc - The current metadata document version.
 * @param currentRev - The revision of the current document.
 * @param conflictedRev - The conflicted revision to compare.
 */
export declare function resolveByNewerEntry(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, id: DocumentID, path: FilePathWithPrefix, currentDoc: MetaEntry, currentRev: string, conflictedRev: string): Promise<void>;
/**
 * Opens a JSON interactive merge dialogue to let the user resolve conflict revisions manually.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param docA - Loaded entry revision A.
 * @param docB - Loaded entry revision B.
 * @returns A promise resolving to true if the merge dialogue was successfully completed; otherwise, false.
 */
export declare function showJSONMergeDialogAndMerge(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, docA: LoadedEntry, docB: LoadedEntry): Promise<boolean>;
/**
 * Creates a QueueProcessor configuration to handle hidden file conflict resolution sequentially.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @returns A QueueProcessor managing file paths with conflicts.
 */
export declare function createConflictResolutionProcessor(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState): QueueProcessor<FilePathWithPrefix, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
