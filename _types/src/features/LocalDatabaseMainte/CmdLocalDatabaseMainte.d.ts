// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type DocumentID, type EntryDoc, type EntryLeaf } from "@lib/common/types";
import { LiveSyncCommands } from "@/features/LiveSyncCommands";
type ChunkID = DocumentID;
type NoteDocumentID = DocumentID;
type Rev = string;
type ChunkUsageMap = Map<NoteDocumentID, Map<Rev, Set<ChunkID>>>;
export declare class LocalDatabaseMaintenance extends LiveSyncCommands {
    onunload(): void;
    onload(): void | Promise<void>;
    allChunks(includeDeleted?: boolean): Promise<{
        used: Set<string>;
        existing: Map<string, EntryLeaf>;
    }>;
    get database(): PouchDB.Database<EntryDoc>;
    clearHash(): void;
    confirm(title: string, message: string, affirmative?: string, negative?: string): Promise<boolean>;
    ensureAvailable(operationName: string): Promise<boolean>;
    /**
     * Resurrect deleted chunks that are still used in the database.
     */
    resurrectChunks(): Promise<void>;
    /**
     * Commit deletion of files that are marked as deleted.
     * This method makes the deletion permanent, and the files will not be recovered.
     * After this, chunks that are used in the deleted files become ready for compaction.
     */
    commitFileDeletion(): Promise<void>;
    /**
     * Commit deletion of chunks that are not used in the database.
     * This method makes the deletion permanent, and the chunks will not be recovered if the database run compaction.
     * After this, the database can shrink the database size by compaction.
     * It is recommended to compact the database after this operation (History should be kept once before compaction).
     */
    commitChunkDeletion(): Promise<void>;
    /**
     * Compact the database.
     * This method removes all deleted chunks that are not used in the database.
     * Make sure all devices are synchronized before running this method.
     */
    markUnusedChunks(): Promise<void>;
    removeUnusedChunks(): Promise<void>;
    scanUnusedChunks(): Promise<{
        chunkSet: Set<DocumentID>;
        chunkUsageMap: ChunkUsageMap;
        unusedSet: Set<DocumentID>;
    }>;
    /**
     * Track changes in the database and update the chunk usage map for garbage collection.
     * Note that this only able to perform without Fetch chunks on demand.
     */
    trackChanges(fromStart?: boolean, showNotice?: boolean): Promise<void>;
    performGC(showingNotice?: boolean): Promise<void>;
    analyseDatabase(): Promise<void>;
    compactDatabase(): Promise<void>;
    gcv3(): Promise<void>;
}
export {};
