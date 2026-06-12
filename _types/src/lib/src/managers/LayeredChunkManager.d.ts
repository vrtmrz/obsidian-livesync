import type { DocumentID, EntryLeaf } from "@lib/common/models/db.type";
import type { EntryDoc } from "@lib/common/models/db.definition";
import type { ChangeManager } from "./ChangeManager.ts";
import type { ChunkManagerEventMap, ChunkManagerOptions, ChunkReadOptions, ChunkWriteOptions, WriteResult } from "./LayeredChunkManager/types.ts";
/**
 * ChunkManager class that manages chunk operations such as reading, writing, and caching.
 * Now uses a middleware layer architecture for read and write operations.
 */
export declare class LayeredChunkManager {
    protected options: ChunkManagerOptions;
    protected eventTarget: EventTarget;
    private cacheLayer;
    private readLayers;
    private writeLayers;
    private arrivalWaitLayer;
    get changeManager(): ChangeManager<EntryDoc>;
    get database(): PouchDB.Database<EntryDoc>;
    get cacheStatistics(): {
        size: number;
        allocCount: number;
        derefCount: number;
    };
    addListener<K extends keyof ChunkManagerEventMap>(type: K, listener: (this: LayeredChunkManager, ev: ChunkManagerEventMap[K]) => any, options?: boolean | AddEventListenerOptions): () => void; // eslint-disable-line @typescript-eslint/no-explicit-any
    emitEvent<K extends keyof ChunkManagerEventMap>(type: K, detail: ChunkManagerEventMap[K]): void;
    protected abort: AbortController;
    protected offChangeHandler: ReturnType<typeof this.changeManager.addCallback>;
    protected initialised: Promise<void>;
    _initialise(): Promise<void>;
    constructor(options: ChunkManagerOptions);
    destroy(): void;
    getCachedChunk(id: DocumentID): EntryLeaf | false;
    getChunkIDFromCache(data: string): DocumentID | false;
    cacheChunk(chunk: EntryLeaf): void;
    clearCaches(): void;
    read(ids: DocumentID[], options: ChunkReadOptions, preloadedChunks?: Record<DocumentID, EntryLeaf>): Promise<(EntryLeaf | false)[]>;
    private executeReadPipeline;
    write(chunks: EntryLeaf[], options: ChunkWriteOptions, origin: DocumentID): Promise<WriteResult>;
    private executeWritePipeline;
    private isChunkDoc;
    private onChunkArrived;
    protected onChunkArrivedHandler: (doc: EntryLeaf, deleted?: boolean) => void;
    private onChange;
    protected onChangeHandler: (change: PouchDB.Core.ChangesResponseChange<EntryLeaf>) => void;
    onMissingChunkRemote(id: DocumentID): void;
    protected onMissingChunkRemoteHandler: (id: DocumentID) => void;
    protected concurrentTransactions: number;
    protected stabilised: Promise<void>;
    transaction<T>(callback: () => Promise<T>): Promise<T>;
    _stabilise(): Promise<void>;
    __stabilise(): Promise<void>;
}
