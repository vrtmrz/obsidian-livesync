// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type AnyEntry, type EntryDoc, type LoadedEntry, type MetaEntry } from "@lib/common/types";
import type { ModuleReplicator } from "./ModuleReplicator";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
export declare class ReplicateResultProcessor {
    private log;
    private logError;
    private replicator;
    constructor(replicator: ModuleReplicator);
    get localDatabase(): import("../../lib/src/pouchdb/LiveSyncLocalDB").LiveSyncLocalDB;
    get services(): import("../../lib/src/services/InjectableServices").InjectableServiceHub<import("../../lib/src/services/base/ServiceBase").ServiceContext>;
    get core(): LiveSyncBaseCore;
    getPath(entry: AnyEntry): string;
    suspend(): void;
    resume(): void;
    private _suspended;
    get isSuspended(): boolean;
    /**
     * Take a snapshot of the current processing state.
     * This snapshot is stored in the KV database for recovery on restart.
     */
    protected _takeSnapshot(): Promise<void>;
    /**
     * Trigger taking a snapshot.
     */
    protected _triggerTakeSnapshot(): void;
    /**
     * Throttled version of triggerTakeSnapshot.
     */
    protected triggerTakeSnapshot: import("octagonal-wheels/function").ThrottledFunction<() => void>;
    /**
     * Restore from snapshot.
     */
    restoreFromSnapshot(): Promise<void>;
    private _restoreFromSnapshot;
    /**
     * Restore from snapshot only once.
     * @returns Promise that resolves when restoration is complete.
     */
    restoreFromSnapshotOnce(): Promise<void>;
    /**
     * Perform the given procedure while counting the concurrency.
     * @param proc async procedure to perform
     * @param countValue reactive source to count concurrency
     * @returns result of the procedure
     */
    withCounting<T>(proc: () => Promise<T>, countValue: ReactiveSource<number>): Promise<T>;
    /**
     * Report the current status.
     */
    protected reportStatus(): void;
    /**
     * Enqueue all the given changes for processing.
     * @param changes Changes to enqueue
     */
    enqueueAll(changes: PouchDB.Core.ExistingDocument<EntryDoc>[]): void;
    /**
     * Process the change if it is not a document change.
     * @param change Change to process
     * @returns True if the change was processed; false otherwise
     */
    protected processIfNonDocumentChange(change: PouchDB.Core.ExistingDocument<EntryDoc>): boolean;
    /**
     * Queue of changes to be processed.
     */
    private _queuedChanges;
    /**
     * List of changes being processed.
     */
    private _processingChanges;
    /**
     * Enqueue the given document change for processing.
     * @param doc Document change to enqueue
     * @returns
     */
    protected enqueueChange(doc: PouchDB.Core.ExistingDocument<EntryDoc>): void;
    /**
     * Trigger processing of the queued changes.
     */
    protected triggerProcessQueue(): void;
    /**
     * Semaphore to limit concurrent processing.
     * This is the per-id semaphore + concurrency-control (max 10 concurrent = 10 documents being processed at the same time).
     */
    private _semaphore;
    /**
     * Flag indicating whether the process queue is currently running.
     */
    private _isRunningProcessQueue;
    /**
     * Process the queued changes.
     */
    private runProcessQueue;
    /**
     * Parse the given document change.
     * @param change
     * @returns
     */
    parseDocumentChange(change: PouchDB.Core.ExistingDocument<EntryDoc>): Promise<void>;
    protected applyToDatabase(doc: PouchDB.Core.ExistingDocument<AnyEntry>): Promise<void>;
    private _applyToDatabase;
    /**
     * Phase 3: Apply the given entry to storage.
     * @param entry
     * @returns
     */
    protected applyToStorage(entry: MetaEntry): Promise<void>;
    /**
     * Check whether processing is required for the given document.
     * @param dbDoc Document to check
     * @returns True if processing is required; false otherwise
     */
    protected checkIsChangeRequiredForDatabaseProcessing(dbDoc: LoadedEntry): Promise<boolean>;
}
