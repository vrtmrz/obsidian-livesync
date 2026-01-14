import {
    SYNCINFO_ID,
    VER,
    type AnyEntry,
    type EntryDoc,
    type EntryLeaf,
    type LoadedEntry,
    type MetaEntry,
} from "@/lib/src/common/types";
import type { ModuleReplicator } from "./ModuleReplicator";
import { getPath, isChunk, isValidPath } from "@/common/utils";
import type { LiveSyncCore } from "@/main";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    Logger,
    type LOG_LEVEL,
} from "@/lib/src/common/logger";
import { fireAndForget, isAnyNote, throttle } from "@/lib/src/common/utils";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore_v2";
import { serialized } from "octagonal-wheels/concurrency/lock";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";

const KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT = "replicationResultProcessorSnapshot";
type ReplicateResultProcessorState = {
    queued: PouchDB.Core.ExistingDocument<EntryDoc>[];
    processing: PouchDB.Core.ExistingDocument<EntryDoc>[];
};
function shortenId(id: string): string {
    return id.length > 10 ? id.substring(0, 10) : id;
}
function shortenRev(rev: string | undefined): string {
    if (!rev) return "undefined";
    return rev.length > 10 ? rev.substring(0, 10) : rev;
}
export class ReplicateResultProcessor {
    private log(message: string, level: LOG_LEVEL = LOG_LEVEL_INFO) {
        Logger(`[ReplicateResultProcessor] ${message}`, level);
    }
    private logError(e: any) {
        Logger(e, LOG_LEVEL_VERBOSE);
    }
    private replicator: ModuleReplicator;

    constructor(replicator: ModuleReplicator) {
        this.replicator = replicator;
    }

    get localDatabase() {
        return this.replicator.core.localDatabase;
    }
    get services() {
        return this.replicator.core.services;
    }
    get core(): LiveSyncCore {
        return this.replicator.core;
    }

    public suspend() {
        this._suspended = true;
    }
    public resume() {
        this._suspended = false;
        fireAndForget(() => this.runProcessQueue());
    }

    // Whether the processing is suspended
    // If true, the processing queue processor bails the loop.
    private _suspended: boolean = false;

    public get isSuspended() {
        return (
            this._suspended ||
            !this.core.services.appLifecycle.isReady ||
            this.replicator.settings.suspendParseReplicationResult ||
            this.core.services.appLifecycle.isSuspended()
        );
    }

    /**
     * Take a snapshot of the current processing state.
     * This snapshot is stored in the KV database for recovery on restart.
     */
    protected async _takeSnapshot() {
        const snapshot = {
            queued: this._queuedChanges.slice(),
            processing: this._processingChanges.slice(),
        } satisfies ReplicateResultProcessorState;
        await this.core.kvDB.set(KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT, snapshot);
        this.log(
            `Snapshot taken. Queued: ${snapshot.queued.length}, Processing: ${snapshot.processing.length}`,
            LOG_LEVEL_DEBUG
        );
        this.reportStatus();
    }
    /**
     * Trigger taking a snapshot.
     */
    protected _triggerTakeSnapshot() {
        fireAndForget(() => this._takeSnapshot());
    }
    /**
     * Throttled version of triggerTakeSnapshot.
     */
    protected triggerTakeSnapshot = throttle(() => this._triggerTakeSnapshot(), 50);

    /**
     * Restore from snapshot.
     */
    public async restoreFromSnapshot() {
        const snapshot = await this.core.kvDB.get<ReplicateResultProcessorState>(
            KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT
        );
        if (snapshot) {
            // Restoring the snapshot re-runs processing for both queued and processing items.
            const newQueue = [...snapshot.processing, ...snapshot.queued, ...this._queuedChanges];
            this._queuedChanges = [];
            this.enqueueAll(newQueue);
            this.log(
                `Restored from snapshot (${snapshot.processing.length + snapshot.queued.length} items)`,
                LOG_LEVEL_INFO
            );
            // await this._takeSnapshot();
        }
    }

    private _restoreFromSnapshot: Promise<void> | undefined = undefined;

    /**
     * Restore from snapshot only once.
     * @returns Promise that resolves when restoration is complete.
     */
    public restoreFromSnapshotOnce() {
        if (!this._restoreFromSnapshot) {
            this._restoreFromSnapshot = this.restoreFromSnapshot();
        }
        return this._restoreFromSnapshot;
    }

    /**
     * Perform the given procedure while counting the concurrency.
     * @param proc async procedure to perform
     * @param countValue reactive source to count concurrency
     * @returns result of the procedure
     */
    async withCounting<T>(proc: () => Promise<T>, countValue: ReactiveSource<number>) {
        countValue.value++;
        try {
            return await proc();
        } finally {
            countValue.value--;
        }
    }

    /**
     * Report the current status.
     */
    protected reportStatus() {
        this.core.replicationResultCount.value = this._queuedChanges.length + this._processingChanges.length;
    }

    /**
     * Enqueue all the given changes for processing.
     * @param changes Changes to enqueue
     */

    public enqueueAll(changes: PouchDB.Core.ExistingDocument<EntryDoc>[]) {
        for (const change of changes) {
            // Check if the change is not a document change (e.g., chunk, versioninfo, syncinfo), and processed it directly.
            const isProcessed = this.processIfNonDocumentChange(change);
            if (!isProcessed) {
                this.enqueueChange(change);
            }
        }
    }
    /**
     * Process the change if it is not a document change.
     * @param change Change to process
     * @returns True if the change was processed; false otherwise
     */
    protected processIfNonDocumentChange(change: PouchDB.Core.ExistingDocument<EntryDoc>) {
        if (!change) {
            this.log(`Received empty change`, LOG_LEVEL_VERBOSE);
            return true;
        }
        if (isChunk(change._id)) {
            // Emit event for new chunk
            this.localDatabase.onNewLeaf(change as EntryLeaf);
            this.log(`Processed chunk: ${shortenId(change._id)}`, LOG_LEVEL_DEBUG);
            return true;
        }
        if (change.type == "versioninfo") {
            this.log(`Version info document received: ${change._id}`, LOG_LEVEL_VERBOSE);
            if (change.version > VER) {
                // Incompatible version, stop replication.
                this.core.replicator.closeReplication();
                this.log(
                    `Remote database updated to incompatible version. update your Self-hosted LiveSync plugin.`,
                    LOG_LEVEL_NOTICE
                );
            }
            return true;
        }
        if (
            change._id == SYNCINFO_ID || // Synchronisation information data
            change._id.startsWith("_design") //design document
        ) {
            this.log(`Skipped system document: ${change._id}`, LOG_LEVEL_VERBOSE);
            return true;
        }
        return false;
    }

    /**
     * Queue of changes to be processed.
     */
    private _queuedChanges: PouchDB.Core.ExistingDocument<EntryDoc>[] = [];

    /**
     * List of changes being processed.
     */
    private _processingChanges: PouchDB.Core.ExistingDocument<EntryDoc>[] = [];

    /**
     * Enqueue the given document change for processing.
     * @param doc Document change to enqueue
     * @returns
     */
    protected enqueueChange(doc: PouchDB.Core.ExistingDocument<EntryDoc>) {
        const old = this._queuedChanges.find((e) => e._id == doc._id);
        const path = "path" in doc ? getPath(doc) : "<unknown>";
        const docNote = `${path} (${shortenId(doc._id)}, ${shortenRev(doc._rev)})`;
        if (old) {
            if (old._rev == doc._rev) {
                this.log(`[Enqueue] skipped (Already queued): ${docNote}`, LOG_LEVEL_VERBOSE);
                return;
            }

            const oldRev = old._rev ?? "";
            const isDeletedBefore = old._deleted === true || ("deleted" in old && old.deleted === true);
            const isDeletedNow = doc._deleted === true || ("deleted" in doc && doc.deleted === true);

            // Replace the old queued change (This may performed batched updates, actually process performed always with the latest version, hence we can simply replace it if the change is the same type).
            if (isDeletedBefore === isDeletedNow) {
                this._queuedChanges = this._queuedChanges.filter((e) => e._id != doc._id);
                this.log(`[Enqueue] requeued: ${docNote} (from rev: ${shortenRev(oldRev)})`, LOG_LEVEL_VERBOSE);
            }
        }
        // Enqueue the change
        this._queuedChanges.push(doc);
        this.triggerTakeSnapshot();
        this.triggerProcessQueue();
    }

    /**
     * Trigger processing of the queued changes.
     */
    protected triggerProcessQueue() {
        fireAndForget(() => this.runProcessQueue());
    }

    /**
     * Semaphore to limit concurrent processing.
     * This is the per-id semaphore + concurrency-control (max 10 concurrent = 10 documents being processed at the same time).
     */
    private _semaphore = Semaphore(10);

    /**
     * Flag indicating whether the process queue is currently running.
     */
    private _isRunningProcessQueue: boolean = false;

    /**
     * Process the queued changes.
     */
    private async runProcessQueue() {
        // Avoid re-entrance, suspend processing, or empty queue loop consumption.
        if (this._isRunningProcessQueue) return;
        if (this.isSuspended) return;
        if (this._queuedChanges.length == 0) return;
        try {
            this._isRunningProcessQueue = true;
            while (this._queuedChanges.length > 0) {
                // If getting suspended, bail the loop. Some concurrent tasks may still be running.
                if (this.isSuspended) {
                    this.log(
                        `Processing has got suspended. Remaining items in queue: ${this._queuedChanges.length}`,
                        LOG_LEVEL_INFO
                    );
                    break;
                }

                // Acquire semaphore for new processing slot
                // (per-document serialisation caps concurrency).
                const releaser = await this._semaphore.acquire();
                releaser();
                // Dequeue the next change
                const doc = this._queuedChanges.shift();
                if (doc) {
                    this._processingChanges.push(doc);
                    void this.parseDocumentChange(doc);
                }
                // Take snapshot (to be restored on next startup if needed)
                this.triggerTakeSnapshot();
            }
        } finally {
            this._isRunningProcessQueue = false;
        }
    }

    // Phase 1: parse replication result
    /**
     * Parse the given document change.
     * @param change
     * @returns
     */
    async parseDocumentChange(change: PouchDB.Core.ExistingDocument<EntryDoc>) {
        try {
            // If the document is a virtual document, process it in the virtual document processor.
            if (await this.services.replication.processVirtualDocument(change)) return;
            // If the document is version info, check compatibility and return.
            if (isAnyNote(change)) {
                const docPath = getPath(change);
                if (!(await this.services.vault.isTargetFile(docPath))) {
                    this.log(`Skipped: ${docPath}`, LOG_LEVEL_VERBOSE);
                    return;
                }
                const size = change.size;
                // Note that this size check depends size that in metadata, not the actual content size.
                if (this.services.vault.isFileSizeTooLarge(size)) {
                    this.log(
                        `Processing ${docPath} has been skipped due to file size exceeding the limit`,
                        LOG_LEVEL_NOTICE
                    );
                    return;
                }
                return await this.applyToDatabase(change);
            }
            this.log(`Skipped unexpected non-note document: ${change._id}`, LOG_LEVEL_INFO);
            return;
        } finally {
            // Remove from processing queue
            this._processingChanges = this._processingChanges.filter((e) => e !== change);
            this.triggerTakeSnapshot();
        }
    }

    // Phase 2: apply the document to database
    protected applyToDatabase(doc: PouchDB.Core.ExistingDocument<AnyEntry>) {
        return this.withCounting(async () => {
            let releaser: Awaited<ReturnType<typeof this._semaphore.acquire>> | undefined = undefined;
            try {
                releaser = await this._semaphore.acquire();
                await this._applyToDatabase(doc);
            } catch (e) {
                this.log(`Error while processing replication result`, LOG_LEVEL_NOTICE);
                this.logError(e);
            } finally {
                // Remove from processing queue (To remove from "in-progress" list, and snapshot will not include it)
                if (releaser) {
                    releaser();
                }
            }
        }, this.replicator.core.databaseQueueCount);
    }
    // Phase 2.1: process the document and apply to storage
    // This function is serialized per document to avoid race-condition for the same document.
    private _applyToDatabase(doc_: PouchDB.Core.ExistingDocument<AnyEntry>) {
        const dbDoc = doc_ as LoadedEntry; // It has no `data`
        const path = getPath(dbDoc);
        return serialized(`replication-process:${dbDoc._id}`, async () => {
            const docNote = `${path} (${shortenId(dbDoc._id)}, ${shortenRev(dbDoc._rev)})`;
            const isRequired = await this.checkIsChangeRequiredForDatabaseProcessing(dbDoc);
            if (!isRequired) {
                this.log(`Skipped (Not latest): ${docNote}`, LOG_LEVEL_VERBOSE);
                return;
            }
            // If `Read chunks online` is disabled, chunks should be transferred before here.
            // However, in some cases, chunks are after that. So, if missing chunks exist, we have to wait for them.
            // (If `Use Only Local Chunks` is enabled, we should not attempt to fetch chunks online automatically).

            const isDeleted = dbDoc._deleted === true || ("deleted" in dbDoc && dbDoc.deleted === true);
            // Gather full document if not deleted
            const doc = isDeleted
                ? { ...dbDoc, data: "" }
                : await this.localDatabase.getDBEntryFromMeta({ ...dbDoc }, false, true);
            if (!doc) {
                // Failed to gather content
                this.log(`Failed to gather content of ${docNote}`, LOG_LEVEL_NOTICE);
                return;
            }
            // Check if other processor wants to process this document, if so, skip processing here.
            if (await this.services.replication.processOptionalSynchroniseResult(dbDoc)) {
                // Already processed
                this.log(`Processed by other processor: ${docNote}`, LOG_LEVEL_DEBUG);
            } else if (isValidPath(getPath(doc))) {
                // Apply to storage if the path is valid
                await this.applyToStorage(doc as MetaEntry);
                this.log(`Processed: ${docNote}`, LOG_LEVEL_DEBUG);
            } else {
                // Should process, but have an invalid path
                this.log(`Unprocessed (Invalid path): ${docNote}`, LOG_LEVEL_VERBOSE);
            }
            return;
        });
    }
    /**
     * Phase 3: Apply the given entry to storage.
     * @param entry
     * @returns
     */
    protected applyToStorage(entry: MetaEntry) {
        return this.withCounting(async () => {
            await this.services.replication.processSynchroniseResult(entry);
        }, this.replicator.core.storageApplyingCount);
    }

    /**
     * Check whether processing is required for the given document.
     * @param dbDoc Document to check
     * @returns True if processing is required; false otherwise
     */
    protected async checkIsChangeRequiredForDatabaseProcessing(dbDoc: LoadedEntry): Promise<boolean> {
        const path = getPath(dbDoc);
        try {
            const savedDoc = await this.localDatabase.getRaw<LoadedEntry>(dbDoc._id, {
                conflicts: true,
                revs_info: true,
            });
            const newRev = dbDoc._rev ?? "";
            const latestRev = savedDoc._rev ?? "";
            const revisions = savedDoc._revs_info?.map((e) => e.rev) ?? [];
            if (savedDoc._conflicts && savedDoc._conflicts.length > 0) {
                // There are conflicts, so we have to process it.
                // (May auto-resolve or user intervention will be occurred).
                return true;
            }
            if (newRev == latestRev) {
                // The latest revision. Simply we can process it.
                return true;
            }
            const index = revisions.indexOf(newRev);
            if (index >= 0) {
                // The revision has been inserted before.
                return false; // This means that the document already processed (While no conflict existed).
            }
            return true; // This mostly should not happen, but we have to process it just in case.
        } catch (e: any) {
            if ("status" in e && e.status == 404) {
                // getRaw failed due to not existing, it may not be happened normally especially on replication.
                // If the process caused by some other reason, we **probably** have to process it.
                // Note that this is not a common case.
                return true;
            } else {
                this.log(
                    `Failed to get existing document for ${path} (${shortenId(dbDoc._id)}, ${shortenRev(dbDoc._rev)}) `,
                    LOG_LEVEL_NOTICE
                );
                this.logError(e);
                return false;
            }
        }
    }
}
