// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DocumentID, EntryLeaf } from "@lib/common/types.ts";
import type { ChunkReadOptions, ChunkWriteOptions, WriteResult } from "./types.ts";
/**
 * Interface for read layers in the chunk reading pipeline.
 * Each layer processes a chunk read request and passes it to the next layer.
 */
export interface IReadLayer {
    /**
     * Process a read request for the given chunk IDs.
     * The next layer in the pipeline should be called to continue processing.
     *
     * @param ids - The chunk IDs to read
     * @param options - Read options
     * @param next - The next layer to process the remaining IDs
     * @returns A promise that resolves to an array of chunks or false values
     */
    read(ids: DocumentID[], options: ChunkReadOptions, next: (remaining: DocumentID[]) => Promise<(EntryLeaf | false)[]>): Promise<(EntryLeaf | false)[]>;
    tearDown?(): void;
}
/**
 * Interface for write layers in the chunk writing pipeline.
 * Each layer processes chunk write requests and passes them to the next layer.
 */
export interface IWriteLayer {
    /**
     * Process a write request for the given chunks.
     * The next layer in the pipeline should be called to continue processing.
     *
     * @param chunks - The chunks to write
     * @param options - Write options
     * @param origin - The origin of the write request
     * @param next - The next layer to process the remaining chunks
     * @returns A promise that resolves to the write result
     */
    write(chunks: EntryLeaf[], options: ChunkWriteOptions, origin: DocumentID, next: (remaining: EntryLeaf[]) => Promise<WriteResult>): Promise<WriteResult>;
    tearDown?(): void;
}
