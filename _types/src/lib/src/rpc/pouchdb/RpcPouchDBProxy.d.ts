// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { RpcSession } from "@lib/rpc/RpcSession";
/**
 * A PouchDB-compatible proxy that forwards all database operations to a remote
 * peer via an {@link RpcSession}.
 *
 * The proxy exposes the same public interface as a PouchDB instance and can be
 * passed directly to `PouchDB.replicate()` or `PouchDB.sync()` as either the
 * source or the target database.  It can also be used with {@link replicateShim}
 * from `ReplicatorShim.ts`.
 *
 * The remote side must have called {@link exposeDB} to register the matching
 * RPC handlers.
 *
 * ### Changes feed
 * `changes()` returns an object that satisfies both the EventEmitter interface
 * required by `pouchdb-replication` and the Promise interface required by
 * `replicateShim` (i.e. it can be `await`ed directly).
 *
 * ### Error propagation
 * PouchDB-specific error properties (`status`, `name`, `reason`) are preserved
 * across the RPC transport and reconstructed on the proxy side so that callers
 * such as `pouchdb-checkpointer` can inspect `err.status === 404` correctly.
 */
export declare class RpcPouchDBProxy extends EventEmitter {
    /** The logical name of the remote database. */
    readonly name: string;
    /**
     * Stub ActiveTasks object required by `pouchdb-replication`.  All
     * operations are no-ops; task state is not tracked across the RPC boundary.
     */
    readonly activeTasks: {
        add: (_task: object) => unknown;
        get: (_id: unknown) => unknown;
        update: (_id: unknown, _update: object) => void;
        remove: (_id: unknown, _err?: Error) => void;
        list: () => unknown[];
    };
    private readonly session;
    private readonly ns;
    constructor(session: RpcSession, name: string, ns?: string);
    /**
     * Invoke an RPC method and reconstruct PouchDB error shapes on the response.
     *
     * When the remote handler wraps a PouchDB error via {@link exposeDB}'s
     * `runDB` helper, the `RpcError.details` object carries `status`, `name`,
     * and `reason`.  This method rebuilds a plain `Error` with those properties
     * so that callers (e.g. pouchdb-checkpointer) can use `err.status` /
     * `err.name` as expected.
     */
    private callDB;
    info(): Promise<PouchDB.Core.DatabaseInfo>;
    id(): Promise<string>;
    /**
     * Returns a `Changes`-compatible object that is simultaneously:
     * - An **EventEmitter** with `change`, `complete`, and `error` events, plus
     *   a `cancel()` method — satisfying the interface consumed by
     *   `PouchDB.replicate()` / `PouchDB.sync()`.
     * - A **thenable** (`then` / `catch`) — allowing `await db.changes(opts)`
     *   as used by `replicateShim`.
     *
     * The remote changes feed is always fetched as a one-shot snapshot
     * (`live: false`).
     */
    changes(opts: PouchDB.Core.ChangesOptions): PouchDB.Core.Changes<object>;
    get<T extends object>(id: string, opts?: PouchDB.Core.GetOptions): Promise<T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta>;
    put<T extends object>(doc: PouchDB.Core.PutDocument<T>, opts?: PouchDB.Core.PutOptions): Promise<PouchDB.Core.Response>;
    bulkGet<T extends object>(opts: PouchDB.Core.BulkGetOptions): Promise<PouchDB.Core.BulkGetResponse<T>>;
    bulkDocs<T extends object>(docs: PouchDB.Core.PostDocument<T>[] | {
        docs: PouchDB.Core.PostDocument<T>[];
        new_edits?: boolean;
    }, opts?: PouchDB.Core.BulkDocsOptions): Promise<(PouchDB.Core.Response | PouchDB.Core.Error)[]>;
    revsDiff(diff: PouchDB.Core.RevisionDiffOptions): Promise<PouchDB.Core.RevisionDiffResponse>;
    allDocs<T extends object>(opts?: PouchDB.Core.AllDocsOptions): Promise<PouchDB.Core.AllDocsResponse<T>>;
}

class EventEmitter {
    on(event: string | symbol, listener: (...args: any[]) => void): this; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    once(event: string | symbol, listener: (...args: any[]) => void): this; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    off(event: string | symbol, listener: (...args: any[]) => void): this; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    emit(event: string | symbol, ...args: any[]): boolean; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    addListener(event: string | symbol, listener: (...args: any[]) => void): this; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    removeAllListeners(event: string | symbol): this;
}
