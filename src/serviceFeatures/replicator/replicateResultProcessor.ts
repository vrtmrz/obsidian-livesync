import {
    SYNCINFO_ID,
    VER,
    type AnyEntry,
    type EntryDoc,
    type EntryLeaf,
    type LoadedEntry,
    type MetaEntry,
} from "@lib/common/types";
import { isChunk } from "@lib/common/typeUtils";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@lib/common/logger";
import { fireAndForget, isAnyNote, throttle } from "@lib/common/utils";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore_v2";
import { serialized } from "octagonal-wheels/concurrency/lock";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import { isNotFoundError } from "@lib/common/utils.doc";
import type { NecessaryObsidianFeature } from "@/types";
import { createInstanceLogFunction, type LogFunction } from "@lib/services/lib/logUtils";

export const KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT = "replicationResultProcessorSnapshot";

export type ReplicateResultProcessorHost = NecessaryObsidianFeature<
    "API" | "appLifecycle" | "database" | "keyValueDB" | "path" | "replication" | "replicator" | "setting" | "vault"
>;

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
const noopReplicateResultProcessorLog: ReplicateResultProcessorLog = () => undefined;

function shortenId(id: string): string {
    return id.length > 10 ? id.substring(0, 10) : id;
}

function shortenRev(rev: string | undefined): string {
    if (!rev) return "undefined";
    return rev.length > 10 ? rev.substring(0, 10) : rev;
}

export function createReplicateResultProcessorLog(host: ReplicateResultProcessorHost): ReplicateResultProcessorLog {
    return createInstanceLogFunction("ReplicateResultProcessor", host.services.API);
}

export function createReplicateResultProcessorState(
    triggerTakeSnapshot: () => void = () => undefined
): ReplicateResultProcessorState {
    return {
        queuedChanges: [],
        processingChanges: [],
        suspended: false,
        restoreFromSnapshot: undefined,
        semaphore: Semaphore(10),
        isRunningProcessQueue: false,
        triggerTakeSnapshot,
    };
}

export function isReplicateResultProcessorSuspended(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState
) {
    return (
        state.suspended ||
        !host.services.appLifecycle.isReady() ||
        host.services.setting.settings.suspendParseReplicationResult ||
        host.services.appLifecycle.isSuspended()
    );
}

export function suspendReplicateResultProcessing(state: ReplicateResultProcessorState) {
    state.suspended = true;
}

export function resumeReplicateResultProcessing(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog = noopReplicateResultProcessorLog
) {
    state.suspended = false;
    fireAndForget(() => runReplicateResultProcessQueue(host, state, log));
}

export async function takeReplicateResultProcessorSnapshot(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog = noopReplicateResultProcessorLog
) {
    const snapshot = {
        queued: state.queuedChanges.slice(),
        processing: state.processingChanges.slice(),
    } satisfies ReplicateResultProcessorSnapshot;
    await host.services.keyValueDB.kvDB.set(KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT, snapshot);
    log(
        `Snapshot taken. Queued: ${snapshot.queued.length}, Processing: ${snapshot.processing.length}`,
        LOG_LEVEL_DEBUG
    );
    reportReplicateResultProcessorStatus(host, state);
}

export async function restoreReplicateResultProcessorSnapshot(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog = noopReplicateResultProcessorLog
) {
    const snapshot = await host.services.keyValueDB.kvDB.get<ReplicateResultProcessorSnapshot>(
        KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT
    );
    if (!snapshot) return;

    // Restoring the snapshot re-runs processing for both queued and processing items.
    const newQueue = [...snapshot.processing, ...snapshot.queued, ...state.queuedChanges];
    state.queuedChanges = [];
    enqueueAllReplicateResults(host, state, log, newQueue);
    log(`Restored from snapshot (${snapshot.processing.length + snapshot.queued.length} items)`, LOG_LEVEL_INFO);
}

export function restoreReplicateResultProcessorSnapshotOnce(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog = noopReplicateResultProcessorLog
) {
    if (!state.restoreFromSnapshot) {
        state.restoreFromSnapshot = restoreReplicateResultProcessorSnapshot(host, state, log);
    }
    return state.restoreFromSnapshot;
}

export async function withCounting<T>(proc: () => Promise<T>, countValue: ReactiveSource<number>) {
    countValue.value++;
    try {
        return await proc();
    } finally {
        countValue.value--;
    }
}

export function reportReplicateResultProcessorStatus(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState
) {
    host.services.replication.replicationResultCount.value =
        state.queuedChanges.length + state.processingChanges.length;
}

export function enqueueAllReplicateResults(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog,
    changes: PouchDB.Core.ExistingDocument<EntryDoc>[]
) {
    for (const change of changes) {
        const isProcessed = processIfNonDocumentChange(host, log, change);
        if (!isProcessed) {
            enqueueReplicateResult(host, state, log, change);
        }
    }
}

export function processIfNonDocumentChange(
    host: ReplicateResultProcessorHost,
    log: ReplicateResultProcessorLog,
    change: PouchDB.Core.ExistingDocument<EntryDoc>
) {
    if (!change) {
        log(`Received empty change`, LOG_LEVEL_VERBOSE);
        return true;
    }
    if (isChunk(change._id)) {
        host.services.database.localDatabase.onNewLeaf(change as EntryLeaf);
        log(`Processed chunk: ${shortenId(change._id)}`, LOG_LEVEL_DEBUG);
        return true;
    }
    if (change.type == "versioninfo") {
        log(`Version info document received: ${change._id}`, LOG_LEVEL_VERBOSE);
        if (change.version > VER) {
            host.services.replicator.getActiveReplicator()?.closeReplication();
            log(
                `Remote database updated to incompatible version. update your Self-hosted LiveSync plugin.`,
                LOG_LEVEL_NOTICE
            );
        }
        return true;
    }
    if (change._id == SYNCINFO_ID || change._id.startsWith("_design")) {
        log(`Skipped system document: ${change._id}`, LOG_LEVEL_VERBOSE);
        return true;
    }
    return false;
}

export function enqueueReplicateResult(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog,
    doc: PouchDB.Core.ExistingDocument<EntryDoc>
) {
    const old = state.queuedChanges.find((e) => e._id == doc._id);
    const path = "path" in doc ? host.services.path.getPath(doc) : "<unknown>";
    const docNote = `${path} (${shortenId(doc._id)}, ${shortenRev(doc._rev)})`;
    if (old) {
        if (old._rev == doc._rev) {
            log(`[Enqueue] skipped (Already queued): ${docNote}`, LOG_LEVEL_VERBOSE);
            return;
        }

        const oldRev = old._rev ?? "";
        const isDeletedBefore = old._deleted === true || ("deleted" in old && old.deleted === true);
        const isDeletedNow = doc._deleted === true || ("deleted" in doc && doc.deleted === true);

        if (isDeletedBefore === isDeletedNow) {
            state.queuedChanges = state.queuedChanges.filter((e) => e._id != doc._id);
            log(`[Enqueue] requeued: ${docNote} (from rev: ${shortenRev(oldRev)})`, LOG_LEVEL_VERBOSE);
        }
    }
    state.queuedChanges.push(doc);
    state.triggerTakeSnapshot();
    fireAndForget(() => runReplicateResultProcessQueue(host, state, log));
}

export async function runReplicateResultProcessQueue(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog = noopReplicateResultProcessorLog
) {
    if (state.isRunningProcessQueue) return;
    if (isReplicateResultProcessorSuspended(host, state)) return;
    if (state.queuedChanges.length == 0) return;
    try {
        state.isRunningProcessQueue = true;
        while (state.queuedChanges.length > 0) {
            if (isReplicateResultProcessorSuspended(host, state)) {
                log(
                    `Processing has got suspended. Remaining items in queue: ${state.queuedChanges.length}`,
                    LOG_LEVEL_INFO
                );
                break;
            }

            const releaser = await state.semaphore.acquire();
            releaser();
            const doc = state.queuedChanges.shift();
            if (doc) {
                state.processingChanges.push(doc);
                void parseReplicateResultDocumentChange(host, state, log, doc);
            }
            state.triggerTakeSnapshot();
        }
    } finally {
        state.isRunningProcessQueue = false;
    }
}

export async function parseReplicateResultDocumentChange(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog,
    change: PouchDB.Core.ExistingDocument<EntryDoc>
) {
    try {
        if (isAnyNote(change)) {
            const docMtime = change.mtime ?? 0;
            const maxMTime = host.services.setting.settings.maxMTimeForReflectEvents;
            if (maxMTime > 0 && docMtime > maxMTime) {
                const docPath = host.services.path.getPath(change);
                log(
                    `Processing ${docPath} has been skipped due to modification time (${new Date(
                        docMtime * 1000
                    ).toISOString()}) exceeding the limit`,
                    LOG_LEVEL_INFO
                );
                return;
            }
        }
        if (await host.services.replication.processVirtualDocument(change)) return;
        if (isAnyNote(change)) {
            const docPath = host.services.path.getPath(change);
            if (!(await host.services.vault.isTargetFile(docPath))) {
                log(`Skipped: ${docPath}`, LOG_LEVEL_VERBOSE);
                return;
            }
            const size = change.size;
            if (host.services.vault.isFileSizeTooLarge(size)) {
                log(`Processing ${docPath} has been skipped due to file size exceeding the limit`, LOG_LEVEL_NOTICE);
                return;
            }
            return await applyReplicateResultToDatabase(host, state, log, change);
        }
        log(`Skipped unexpected non-note document: ${change._id}`, LOG_LEVEL_INFO);
        return;
    } finally {
        state.processingChanges = state.processingChanges.filter((e) => e !== change);
        state.triggerTakeSnapshot();
    }
}

export function applyReplicateResultToDatabase(
    host: ReplicateResultProcessorHost,
    state: ReplicateResultProcessorState,
    log: ReplicateResultProcessorLog,
    doc: PouchDB.Core.ExistingDocument<AnyEntry>
) {
    return withCounting(async () => {
        let releaser: Awaited<ReturnType<typeof state.semaphore.acquire>> | undefined = undefined;
        try {
            releaser = await state.semaphore.acquire();
            await applyReplicateResultToDatabaseInternal(host, log, doc);
        } catch (e) {
            log(`Error while processing replication result`, LOG_LEVEL_NOTICE);
            log(e, LOG_LEVEL_VERBOSE);
        } finally {
            releaser?.();
        }
    }, host.services.replication.databaseQueueCount);
}

export function applyReplicateResultToDatabaseInternal(
    host: ReplicateResultProcessorHost,
    log: ReplicateResultProcessorLog,
    doc_: PouchDB.Core.ExistingDocument<AnyEntry>
) {
    const dbDoc = doc_ as LoadedEntry;
    const path = host.services.path.getPath(dbDoc);
    return serialized(`replication-process:${dbDoc._id}`, async () => {
        const docNote = `${path} (${shortenId(dbDoc._id)}, ${shortenRev(dbDoc._rev)})`;
        const isRequired = await checkIsChangeRequiredForDatabaseProcessing(host, log, dbDoc);
        if (!isRequired) {
            log(`Skipped (Not latest): ${docNote}`, LOG_LEVEL_VERBOSE);
            return;
        }

        const isDeleted = dbDoc._deleted === true || ("deleted" in dbDoc && dbDoc.deleted === true);
        const doc = isDeleted
            ? { ...dbDoc, data: "" }
            : await host.services.database.localDatabase.getDBEntryFromMeta({ ...dbDoc }, false, true);
        if (!doc) {
            log(`Failed to gather content of ${docNote}`, LOG_LEVEL_NOTICE);
            return;
        }
        if (await host.services.replication.processOptionalSynchroniseResult(dbDoc)) {
            log(`Processed by other processor: ${docNote}`, LOG_LEVEL_DEBUG);
        } else if (host.services.vault.isValidPath(host.services.path.getPath(doc))) {
            await applyReplicateResultToStorage(host, doc as MetaEntry);
            log(`Processed: ${docNote}`, LOG_LEVEL_DEBUG);
        } else {
            log(`Unprocessed (Invalid path): ${docNote}`, LOG_LEVEL_VERBOSE);
        }
    });
}

export function applyReplicateResultToStorage(host: ReplicateResultProcessorHost, entry: MetaEntry) {
    return withCounting(async () => {
        await host.services.replication.processSynchroniseResult(entry);
    }, host.services.replication.storageApplyingCount);
}

export async function checkIsChangeRequiredForDatabaseProcessing(
    host: ReplicateResultProcessorHost,
    log: ReplicateResultProcessorLog,
    dbDoc: LoadedEntry
): Promise<boolean> {
    const path = host.services.path.getPath(dbDoc);
    try {
        const savedDoc = await host.services.database.localDatabase.getRaw<LoadedEntry>(dbDoc._id, {
            conflicts: true,
            revs_info: true,
        });
        const newRev = dbDoc._rev ?? "";
        const latestRev = savedDoc._rev ?? "";
        const revisions = savedDoc._revs_info?.map((e) => e.rev) ?? [];
        if (savedDoc._conflicts && savedDoc._conflicts.length > 0) {
            return true;
        }
        if (newRev == latestRev) {
            return true;
        }
        const index = revisions.indexOf(newRev);
        if (index >= 0) {
            return false;
        }
        return true;
    } catch (e) {
        if (isNotFoundError(e)) {
            return true;
        }
        log(
            `Failed to get existing document for ${path} (${shortenId(dbDoc._id)}, ${shortenRev(dbDoc._rev)}) `,
            LOG_LEVEL_NOTICE
        );
        log(e, LOG_LEVEL_VERBOSE);
        return false;
    }
}

export function useReplicateResultProcessor(host: ReplicateResultProcessorHost): ReplicateResultProcessor {
    const log = createReplicateResultProcessorLog(host);
    const state = createReplicateResultProcessorState();
    state.triggerTakeSnapshot = throttle(() => {
        fireAndForget(() => takeReplicateResultProcessorSnapshot(host, state, log));
    }, 50);

    return {
        suspend: () => suspendReplicateResultProcessing(state),
        resume: () => resumeReplicateResultProcessing(host, state, log),
        enqueueAll: (changes) => enqueueAllReplicateResults(host, state, log, changes),
        restoreFromSnapshotOnce: () => restoreReplicateResultProcessorSnapshotOnce(host, state, log),
    };
}
