import type { EntryDoc } from "@lib/common/models/db.definition";
import type { EntryLeaf, DocumentID, FilePathWithPrefix, FilePath, DatabaseEntry, LoadedEntry, MetaEntry, SavingEntry } from "@lib/common/models/db.type";
import type { Credential } from "@lib/common/models/auth.type";
import type { RemoteDBSettings } from "@lib/common/models/setting.type";
import type { diff_result_leaf } from "@lib/common/models/diff.definition";
import { eventHub } from "@lib/hub/hub.ts";
import { LiveSyncManagers } from "@lib/managers/LiveSyncManagers.ts";
import type { AutoMergeResult } from "@lib/managers/ConflictManager.ts";
import type { IServiceHub } from "@lib/services/base/IService.ts";
import { type LogFunction } from "@lib/services/lib/logUtils.ts";
export declare const REMOTE_CHUNK_FETCHED = "remote-chunk-fetched";
export type REMOTE_CHUNK_FETCHED = typeof REMOTE_CHUNK_FETCHED;
declare global {
    interface LSEvents {
        [REMOTE_CHUNK_FETCHED]: EntryLeaf;
    }
}
export type ChunkRetrievalResultSuccess = {
    _id: DocumentID;
    data: string;
    type: "leaf";
};
export type ChunkRetrievalResultError = {
    _id: DocumentID;
    error: string;
};
export type ChunkRetrievalResult = ChunkRetrievalResultSuccess | ChunkRetrievalResultError;
export interface LiveSyncLocalDBEnv {
    services: Pick<IServiceHub, "API" | "database" | "databaseEvents" | "replicator" | "setting" | "path">;
}
export declare function getNoFromRev(rev: string): number;
export type GeneratedChunk = {
    isNew: boolean;
    id: DocumentID;
    piece: string;
};
export declare class LiveSyncLocalDB {
    auth: Credential;
    dbname: string;
    settings: RemoteDBSettings;
    localDatabase: PouchDB.Database<EntryDoc>;
    _log: LogFunction;
    private _managers?;
    get managers(): LiveSyncManagers;
    isReady: boolean;
    needScanning: boolean;
    env: LiveSyncLocalDBEnv;
    clearCaches(): void;
    _prepareHashFunctions(): Promise<void>;
    onunload(): void;
    refreshSettings(): void;
    offRemoteChunkFetchedHandler?: ReturnType<typeof eventHub.onEvent>;
    constructor(dbname: string, env: LiveSyncLocalDBEnv);
    close(): Promise<void>;
    onNewLeaf(chunk: EntryLeaf): void;
    initializeDatabase(): Promise<boolean>;
    /**
     * Retrieve all used and existing chunks in the database.
     * @param includeDeleted  include deleted chunks in the result.
     * @returns {used: Set<string>, existing: Map<string, EntryLeaf>} used: Set of chunk ids that are used in the database. existing: Map of chunk id and EntryLeaf that are existing in the database.
     */
    allChunks(includeDeleted?: boolean): Promise<{
        used: Set<string>;
        existing: Map<string, EntryLeaf>;
    }>;
    resetDatabase(): Promise<boolean>;
    findEntries(startKey: string, endKey: string, opt: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<(import("@lib/common/models/db.type").NewEntry & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").PlainEntry & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").NewEntry & import("@lib/common/models/db.type").EntryWithBody & {
        datatype: import("@lib/common/models/db.type").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").PlainEntry & import("@lib/common/models/db.type").EntryWithBody & {
        datatype: import("@lib/common/models/db.type").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta), void, unknown>;
    findAllDocs(opt?: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<(import("@lib/common/models/db.type").NewEntry & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").PlainEntry & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").NewEntry & import("@lib/common/models/db.type").EntryWithBody & {
        datatype: import("@lib/common/models/db.type").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").PlainEntry & import("@lib/common/models/db.type").EntryWithBody & {
        datatype: import("@lib/common/models/db.type").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta), void, unknown>;
    findEntryNames(startKey: string, endKey: string, opt: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<string, void, unknown>;
    findAllDocNames(opt?: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<string, void, unknown>;
    findAllNormalDocs(opt?: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<(import("@lib/common/models/db.type").NewEntry & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").PlainEntry & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").NewEntry & import("@lib/common/models/db.type").EntryWithBody & {
        datatype: import("@lib/common/models/db.type").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (import("@lib/common/models/db.type").PlainEntry & import("@lib/common/models/db.type").EntryWithBody & {
        datatype: import("@lib/common/models/db.type").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta), void, unknown>;
    removeRevision(docId: DocumentID, revision: string): Promise<boolean>;
    getRaw<T extends EntryDoc>(docId: DocumentID, options?: PouchDB.Core.GetOptions): Promise<T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta>;
    removeRaw(docId: DocumentID, revision: string, options?: PouchDB.Core.Options): Promise<PouchDB.Core.Response>;
    putRaw<T extends EntryDoc>(doc: T, options?: PouchDB.Core.PutOptions): Promise<PouchDB.Core.Response>;
    allDocsRaw<T extends EntryDoc | DatabaseEntry>(options?: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions | PouchDB.Core.AllDocsOptions): Promise<PouchDB.Core.AllDocsResponse<T>>;
    bulkDocsRaw<T extends EntryDoc>(docs: Array<PouchDB.Core.PutDocument<T>>, options?: PouchDB.Core.BulkDocsOptions): Promise<Array<PouchDB.Core.Response | PouchDB.Core.Error>>;
    isTargetFile(filenameSrc: string): boolean;
    getDBEntryMeta(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions, includeDeleted?: boolean): Promise<false | LoadedEntry>;
    getDBEntry(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions, dump?: boolean, waitForReady?: boolean, includeDeleted?: boolean): Promise<false | LoadedEntry>;
    getDBEntryFromMeta(meta: LoadedEntry | MetaEntry, dump?: boolean, waitForReady?: boolean): Promise<false | LoadedEntry>;
    deleteDBEntry(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions): Promise<boolean>;
    putDBEntry(note: SavingEntry, onlyChunks?: boolean, conflictBaseRev?: string): Promise<false | PouchDB.Core.Response>;
    getConflictedDoc(path: FilePathWithPrefix, rev: string): Promise<false | diff_result_leaf>;
    tryAutoMerge(path: FilePathWithPrefix, enableMarkdownAutoMerge: boolean): AutoMergeResult;
}
