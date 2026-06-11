import type { EntryLeaf, DocumentID } from "@lib/common/models/db.type";
import type { IWriteLayer } from "./ChunkLayerInterfaces";
import type { ChunkWriteOptions, WriteResult } from "./types.ts";
/**
 * Hot pack layer - placeholder for hot pack processing
 */
export declare class HotPackLayer implements IWriteLayer {
    write(chunks: EntryLeaf[], options: ChunkWriteOptions, origin: DocumentID, next: (remaining: EntryLeaf[]) => Promise<WriteResult>): Promise<WriteResult>;
}
