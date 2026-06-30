// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DocumentID, EntryLeaf } from "@lib/common/types";
import type { IReadLayer, IWriteLayer } from "./ChunkLayerInterfaces";
import type { ChunkReadOptions, ChunkWriteOptions, WriteResult } from "./types.ts";
/**
 * Cache layer - manages in-memory cache of chunks.
 * Implements both IReadLayer and IWriteLayer for unified cache management.
 * This layer is self-contained and handles cache operations for both read and write operations.
 */
export declare class CacheLayer implements IReadLayer, IWriteLayer {
    private caches;
    private maxCacheSize;
    allocCount: number;
    derefCount: number;
    constructor(maxCacheSize: number);
    /**
     * Get a cached chunk
     */
    getCachedChunk(id: DocumentID): EntryLeaf | false;
    /**
     * Find chunk ID by data content
     */
    getChunkIDFromCache(data: string): DocumentID | false;
    /**
     * Cache a chunk
     */
    cacheChunk(chunk: EntryLeaf): void;
    /**
     * Reorder chunk for LRU (move to end)
     */
    reorderChunk(id: DocumentID): void;
    /**
     * Delete a cached chunk
     */
    deleteCachedChunk(id: DocumentID): void;
    /**
     * Clear all caches
     */
    clearCaches(): void;
    /**
     * Tear down the layer (clear caches on shutdown)
     */
    tearDown(): void;
    /**
     * Get current cache statistics
     */
    getStatistics(): {
        size: number;
        allocCount: number;
        derefCount: number;
    };
    /**
     * IReadLayer implementation - read from cache
     */
    read(ids: DocumentID[], options: ChunkReadOptions, next: (remaining: DocumentID[]) => Promise<(EntryLeaf | false)[]>): Promise<(EntryLeaf | false)[]>;
    /**
     * IWriteLayer implementation - cache chunks after database write
     */
    write(chunks: EntryLeaf[], options: ChunkWriteOptions, origin: DocumentID, next: (remaining: EntryLeaf[]) => Promise<WriteResult>): Promise<WriteResult>;
}
