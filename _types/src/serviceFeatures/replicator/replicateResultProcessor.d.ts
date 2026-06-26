// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type AnyEntry, type EntryDoc, type LoadedEntry, type MetaEntry } from "@lib/common/types";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore_v2";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { NecessaryObsidianFeature } from "@/types";
import { type LogFunction } from "@lib/services/lib/logUtils";
export declare const KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT = "replicationResultProcessorSnapshot";
export type ReplicateResultProcessorHost = NecessaryObsidianFeature<"API" | "appLifecycle" | "database" | "keyValueDB" | "path" | "replication" | "replicator" | "setting" | "vault">;
export type ReplicateResultProcessorSnapshot = {
    queued: PouchDB.Core.ExistingDocument<EntryDoc>[];
    processing: PouchDB.Core.ExistingDocument<EntryDoc>[];
};
export type ReplicateResultProcessorState = {
    queuedChanges: PouchDB.Core.ExistingDocument<EntryDoc>[];
    processingChanges: PouchDB.Core.ExistingDocument<EntryDoc>[];
    suspended: boolean;
    restoreFromSnapshot: Promise<void> | undefined;
    semaphore: ReturnType<typeof Semaphore>;
    isRunningProcessQueue: boolean;
    triggerTakeSnapshot: () => void;
};
export type ReplicateResultProcessor = {
    suspend: () => void;
    resume: () => void;
    enqueueAll: (changes: PouchDB.Core.ExistingDocument<EntryDoc>[]) => void;
    restoreFromSnapshotOnce: () => Promise<void>;
};
type ReplicateResultProcessorLog = LogFunction;
export declare function createReplicateResultProcessorLog(host: ReplicateResultProcessorHost): ReplicateResultProcessorLog;
export declare function createReplicateResultProcessorState(triggerTakeSnapshot?: () => void): ReplicateResultProcessorState;
export declare function isReplicateResultProcessorSuspended(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState): boolean;
export declare function suspendReplicateResultProcessing(state: ReplicateResultProcessorState): void;
export declare function resumeReplicateResultProcessing(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log?: ReplicateResultProcessorLog): void;
export declare function takeReplicateResultProcessorSnapshot(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log?: ReplicateResultProcessorLog): Promise<void>;
export declare function restoreReplicateResultProcessorSnapshot(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log?: ReplicateResultProcessorLog): Promise<void>;
export declare function restoreReplicateResultProcessorSnapshotOnce(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log?: ReplicateResultProcessorLog): Promise<void>;
export declare function withCounting<T>(proc: () => Promise<T>, countValue: ReactiveSource<number>): Promise<T>;
export declare function reportReplicateResultProcessorStatus(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState): void;
export declare function enqueueAllReplicateResults(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log: ReplicateResultProcessorLog, changes: PouchDB.Core.ExistingDocument<EntryDoc>[]): void;
export declare function processIfNonDocumentChange(host: ReplicateResultProcessorHost, log: ReplicateResultProcessorLog, change: PouchDB.Core.ExistingDocument<EntryDoc>): boolean;
export declare function enqueueReplicateResult(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log: ReplicateResultProcessorLog, doc: PouchDB.Core.ExistingDocument<EntryDoc>): void;
export declare function runReplicateResultProcessQueue(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log?: ReplicateResultProcessorLog): Promise<void>;
export declare function parseReplicateResultDocumentChange(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log: ReplicateResultProcessorLog, change: PouchDB.Core.ExistingDocument<EntryDoc>): Promise<void>;
export declare function applyReplicateResultToDatabase(host: ReplicateResultProcessorHost, state: ReplicateResultProcessorState, log: ReplicateResultProcessorLog, doc: PouchDB.Core.ExistingDocument<AnyEntry>): Promise<void>;
export declare function applyReplicateResultToDatabaseInternal(host: ReplicateResultProcessorHost, log: ReplicateResultProcessorLog, doc_: PouchDB.Core.ExistingDocument<AnyEntry>): Promise<void>;
export declare function applyReplicateResultToStorage(host: ReplicateResultProcessorHost, entry: MetaEntry): Promise<void>;
export declare function checkIsChangeRequiredForDatabaseProcessing(host: ReplicateResultProcessorHost, log: ReplicateResultProcessorLog, dbDoc: LoadedEntry): Promise<boolean>;
export declare function useReplicateResultProcessor(host: ReplicateResultProcessorHost): ReplicateResultProcessor;
export {};
