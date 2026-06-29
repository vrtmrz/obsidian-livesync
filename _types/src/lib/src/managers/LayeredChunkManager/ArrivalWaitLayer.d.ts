// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DocumentID, EntryLeaf } from "@lib/common/types";
import type { IReadLayer } from "./ChunkLayerInterfaces";
import type { ChunkReadOptions } from "./types.ts";
/**
 * Arrival wait layer - emits events for fetcher, and waits for chunks to arrive
 */
export declare class ArrivalWaitLayer implements IReadLayer {
    private waitingMap;
    private readonly DEFAULT_TIMEOUT;
    private readonly eventEmitter;
    constructor(eventEmitter: (eventName: string, data: DocumentID[]) => void);
    private enqueueWaiting;
    private withTimeout;
    /**
     * Handle chunk arrival (called when a chunk document arrives)
     */
    onChunkArrived(doc: EntryLeaf, deleted?: boolean): void;
    /**
     * Handle missing chunk (called when a chunk is confirmed missing)
     */
    onMissingChunk(id: DocumentID): void;
    read(ids: DocumentID[], options: ChunkReadOptions, next: (remaining: DocumentID[]) => Promise<(EntryLeaf | false)[]>): Promise<(EntryLeaf | false)[]>;
    /**
     * Clear all waiting requests
     */
    clearWaiting(): void;
    tearDown(): void;
    /**
     * Get count of waiting chunks
     */
    getWaitingCount(): number;
}
