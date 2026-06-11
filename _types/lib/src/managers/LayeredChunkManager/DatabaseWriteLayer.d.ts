import type { EntryLeaf, DocumentID } from "@lib/common/models/db.type";
import type { EntryDoc } from "@lib/common/models/db.definition";
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
