// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { EntryLeaf, DocumentID } from "@lib/common/types";
import type { IWriteLayer } from "./ChunkLayerInterfaces";
import type { ChunkWriteOptions, WriteResult } from "./types.ts";
/**
 * Hot pack layer - placeholder for hot pack processing
 */
export declare class HotPackLayer implements IWriteLayer {
    write(chunks: EntryLeaf[], options: ChunkWriteOptions, origin: DocumentID, next: (remaining: EntryLeaf[]) => Promise<WriteResult>): Promise<WriteResult>;
}
