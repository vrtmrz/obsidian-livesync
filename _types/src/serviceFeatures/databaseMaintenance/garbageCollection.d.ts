// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type DocumentID } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
type ChunkID = DocumentID;
type NoteDocumentID = DocumentID;
type Rev = string;
type ChunkUsageMap = Map<NoteDocumentID, Map<Rev, Set<ChunkID>>>;
/**
 * Resurrects deleted chunks that are still referenced and used by files in the database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function resurrectChunks(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
/**
 * Commits the deletion of files marked as deleted, removing them permanently from the database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function commitFileDeletion(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
/**
 * Permanently deletes chunks already marked as deleted.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function commitChunkDeletion(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
/**
 * Marks chunks that are not referenced by any files in the database as deleted.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function markUnusedChunks(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
/**
 * Directly removes unused chunks from the local database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function removeUnusedChunks(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
/**
 * Scans key-value store logs to calculate unused chunks.
 *
 * @param host - The service container host.
 * @returns Scan summary.
 */
export declare function scanUnusedChunks(host: DatabaseMaintenanceHost): Promise<{
    chunkSet: Set<DocumentID>;
    chunkUsageMap: ChunkUsageMap;
    unusedSet: Set<DocumentID>;
}>;
/**
 * Tracks database changes to maintain the chunk usage map cache.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param fromStart - Whether to force scan from the beginning of sequence.
 * @param showNotice - Whether to show log notices to user.
 */
export declare function trackChanges(host: DatabaseMaintenanceHost, log: LogFunction, fromStart?: boolean, showNotice?: boolean): Promise<void>;
/**
 * Perfroms the legacy Garbage Collection process, scanning and removing unreferenced chunks.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param showingNotice - Whether to show log notices to user.
 */
export declare function performGC(host: DatabaseMaintenanceHost, log: LogFunction, showingNotice?: boolean): Promise<void>;
/**
 * Runs Garbage Collection V3, which validates synchronization progress across connected nodes before deleting.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function gcv3(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
export {};
