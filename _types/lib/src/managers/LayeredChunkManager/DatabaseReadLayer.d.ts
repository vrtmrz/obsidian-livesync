import type { EntryLeaf, DocumentID } from "@lib/common/models/db.type";
import type { EntryDoc } from "@lib/common/models/db.definition";
import type { IReadLayer } from "./ChunkLayerInterfaces";
import type { ChunkReadOptions } from "./types.ts";
/**
 * Database read layer - reads chunks from the database
 */
export declare class DatabaseReadLayer implements IReadLayer {
    private database;
    constructor(database: PouchDB.Database<EntryDoc>);
    private isChunkDoc;
    private getError;
    private isMissingError;
    read(ids: DocumentID[], options: ChunkReadOptions, next: (remaining: DocumentID[]) => Promise<(EntryLeaf | false)[]>): Promise<(EntryLeaf | false)[]>;
}
