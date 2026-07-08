// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type DocumentID } from "@lib/common/types.ts";
import { type ChunkManager } from "./ChunkManager.ts";
import type { IReplicatorService, ISettingService } from "@lib/services/base/IService.ts";
export declare const EVENT_MISSING_CHUNKS = "missingChunks";
export declare const EVENT_MISSING_CHUNK_REMOTE = "missingChunkRemote";
export declare const EVENT_CHUNK_FETCHED = "chunkFetched";
export type ChunkFetcherOptions = {
    settingService: ISettingService;
    chunkManager: ChunkManager;
    replicatorService: IReplicatorService;
};
export declare class ChunkFetcher {
    options: ChunkFetcherOptions;
    get chunkManager(): ChunkManager;
    queue: DocumentID[];
    get interval(): number;
    get concurrency(): number;
    abort: AbortController;
    constructor(options: ChunkFetcherOptions);
    destroy(): void;
    onEventHandler: (ids: DocumentID[]) => void;
    onEvent(ids: DocumentID[]): void;
    /**
     * Processing requests
     */
    currentProcessing: number;
    /**
     * Time of the last request to the remote server.
     * This is used to manage the interval between requests.
     * Even if concurrency allows, every start of a request will ensure that the interval is respected.
     */
    previousRequestTime: number;
    canRequestMore(): boolean;
    requestMissingChunks(): Promise<void>;
}
