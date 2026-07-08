// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export type SomeDocument<T extends object> = PouchDB.Core.ExistingDocument<T> & PouchDB.Core.ChangesMeta;
/**
 * Minimal subset of the PouchDB public API required by {@link replicateShim}.
 * Both a real `PouchDB.Database` and an {@link RpcPouchDBProxy} satisfy this
 * interface, allowing replication across an RPC transport.
 */
export type PouchDBShim<T extends object> = {
    info: () => Promise<PouchDB.Core.DatabaseInfo>;
    changes: (options: PouchDB.Core.ChangesOptions) => PromiseLike<PouchDB.Core.ChangesResponse<T>>;
    revsDiff: (diff: PouchDB.Core.RevisionDiffOptions) => Promise<PouchDB.Core.RevisionDiffResponse>;
    bulkDocs: (docs: PouchDB.Core.PutDocument<T>[], options?: PouchDB.Core.BulkDocsOptions) => Promise<(PouchDB.Core.Response | PouchDB.Core.Error)[]>;
    bulkGet: (options: PouchDB.Core.BulkGetOptions) => Promise<PouchDB.Core.BulkGetResponse<T>>;
    put: (doc: PouchDB.Core.PutDocument<T>, options?: PouchDB.Core.PutOptions) => Promise<PouchDB.Core.Response>;
    get: (id: string, options?: PouchDB.Core.GetOptions) => Promise<T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta>;
};
type CompatibleDatabase<T extends object> = PouchDB.Database<SomeDocument<T>> | PouchDBShim<SomeDocument<T>>;
/** Upserts a document by `id`, calling `func` to produce the updated version. */
export declare function upsert<V extends object, TDB extends CompatibleDatabase<object> = CompatibleDatabase<any>, T extends SomeDocument<V> = SomeDocument<V>>(db: TDB, id: string, func: (doc: T) => T): Promise<T>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
export type ShimReplicationOptionBase = {
    rewind?: boolean;
    batch_size?: number;
};
export type ShimReplicationOneShot = {
    live?: false;
    controller?: AbortController;
} & ShimReplicationOptionBase;
export type ShimReplicationOptionContinuous = {
    live: true;
    controller: AbortController;
} & ShimReplicationOptionBase;
export type ShimReplicationOption = ShimReplicationOneShot | ShimReplicationOptionContinuous;
export type ProgressInfo = {
    lastSeq: number;
    maxSeqInBatch: number;
};
export type ShimReplicationProgressReportFunc<T extends object> = (progress: SomeDocument<T>[], progressInfo: ProgressInfo) => Promise<void>;
/**
 * Replicate documents from `sourceDB` into `targetDB` using a CouchDB-style
 * checkpoint protocol.
 *
 * Both parameters accept either a real `PouchDB.Database` or any object
 * implementing {@link PouchDBShim} — including {@link RpcPouchDBProxy} — so
 * replication can span an RPC transport boundary.
 *
 * @param targetDB  Destination database (usually local).
 * @param sourceDB  Source database (may be remote / RPC-backed).
 * @param progress  Called after each batch with the written documents.
 * @param option    Replication options (live mode, batch size, abort signal).
 */
export declare function replicateShim<T extends CompatibleDatabase<V>, U extends CompatibleDatabase<V>, V extends object>(targetDB: T, sourceDB: U, progress: ShimReplicationProgressReportFunc<V>, option?: ShimReplicationOption): Promise<void>;
export {};
