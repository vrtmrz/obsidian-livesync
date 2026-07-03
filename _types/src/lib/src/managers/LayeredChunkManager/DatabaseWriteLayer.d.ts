// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { EntryLeaf, DocumentID, EntryDoc } from "@lib/common/types";
import type { IWriteLayer } from "./ChunkLayerInterfaces";
import type { ChunkWriteOptions, WriteResult } from "./types.ts";
/**
 * Database write layer - writes chunks to the database
 */
export declare class DatabaseWriteLayer implements IWriteLayer {
    private database;
    constructor(database: PouchDB.Database<EntryDoc>);
    write(chunks: EntryLeaf[], options: ChunkWriteOptions | undefined, origin: DocumentID, next: (remaining: EntryLeaf[]) => Promise<WriteResult>): Promise<WriteResult>;
}
