// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type EntryDoc, type EntryLeaf, type Credential, type RemoteDBSettings, type DocumentID, type FilePathWithPrefix, type FilePath, type DatabaseEntry, type LoadedEntry, type MetaEntry, type SavingEntry, type diff_result_leaf } from "@lib/common/types.ts";
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
    findEntries(startKey: string, endKey: string, opt: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<(DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_PLAIN"];
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        deleted?: boolean;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_PLAIN"];
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        deleted?: boolean;
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta), void, unknown>;
    findAllDocs(opt?: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<(DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_PLAIN"];
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        deleted?: boolean;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_PLAIN"];
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        deleted?: boolean;
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta), void, unknown>;
    findEntryNames(startKey: string, endKey: string, opt: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<string, void, unknown>;
    findAllDocNames(opt?: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<string, void, unknown>;
    findAllNormalDocs(opt?: PouchDB.Core.AllDocsWithKeyOptions | PouchDB.Core.AllDocsOptions | PouchDB.Core.AllDocsWithKeysOptions | PouchDB.Core.AllDocsWithinRangeOptions): AsyncGenerator<(DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_PLAIN"];
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        deleted?: boolean;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_PLAIN"];
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
    } & PouchDB.Core.AllDocsMeta & PouchDB.Core.IdMeta & PouchDB.Core.RevisionIdMeta) | (DatabaseEntry & import("@lib/common/types.ts").EntryBase & import("@lib/common/types.ts").EntryWithEden & {
        path: FilePathWithPrefix;
        children: string[];
        type: import("../common/models/db.type.ts").EntryTypes["NOTE_BINARY"];
    } & {
        deleted?: boolean;
    } & {
        data: string | string[];
        datatype: import("@lib/common/types.ts").EntryTypeNotes;
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
