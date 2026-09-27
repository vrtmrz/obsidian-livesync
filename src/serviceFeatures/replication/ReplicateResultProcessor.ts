import {
    SYNCINFO_ID,
    VERSIONING_DOCID,
    type EntryVersionInfo,
    type AnyEntry,
    type EntryDoc,
    type EntryLeaf,
    type LoadedEntry,
    type MetaEntry,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    assessRemoteFeatureDocument,
    describeRemoteFeatureRejection,
    REMOTE_FEATURE_GENERATION,
} from "@vrtmrz/livesync-commonlib/replication";
import { isChunk } from "@vrtmrz/livesync-commonlib/compat/common/typeUtils";
import {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    Logger,
    type LOG_LEVEL,
} from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { fireAndForget, isAnyNote, throttle } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore_v2";
import { serialized } from "octagonal-wheels/concurrency/lock";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { isNotFoundError } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import type PouchDB from "pouchdb-core";
import { promiseWithResolvers, type PromiseWithResolvers } from "octagonal-wheels/promises";
import { $msg } from "@/common/translation";

const KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT = "replicationResultProcessorSnapshot";
const REPROCESS_BATCH_SIZE = 100;
type ReplicateResultProcessorSettings = Pick<
    ObsidianLiveSyncSettings,
    "maxMTimeForReflectEvents" | "suspendParseReplicationResult"
>;
type ReplicateResultProcessorServices = Pick<
    LiveSyncBaseCore["services"],
    "appLifecycle" | "database" | "path" | "replication" | "vault"
>;

/**
 * Narrow collaborators for applying replicated documents.
 *
 * `requestActiveReplicatorRetirement` starts the owner transition without
 * awaiting it. Result application can still be running inside work admitted by
 * that owner, so awaiting retirement here could make each side wait for the
 * other to finish.
 *
 * Runtime databases are deliberately obtained through operation-time
 * accessors. Feature composition precedes their initialisation, and database
 * reset may replace their backing instances, so retaining an earlier concrete
 * database would be invalid.
 */
interface ReplicateResultProcessorContext {
    readonly currentSettings: () => ReplicateResultProcessorSettings;
    readonly getKeyValueDB: () => LiveSyncBaseCore["kvDB"];
    readonly getLocalDatabase: () => LiveSyncBaseCore["localDatabase"];
    readonly requestActiveReplicatorRetirement: () => void;
    readonly runLocalApplicationActivity: <T>(
        task: () => T | PromiseLike<T>,
        options?: { label?: string }
    ) => Promise<T>;
    readonly services: ReplicateResultProcessorServices;
}
type ReplicateResultProcessorState = {
    databaseId?: string;
    observedFeatures?: string[];
    highestObservedVersion?: number;
    invalidControlObserved?: boolean;
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
function getPhysicalDatabaseId(database: PouchDB.Database<EntryDoc>): Promise<string | undefined> {
    const identified = database as PouchDB.Database<EntryDoc> & { id?: () => Promise<string> };
    return typeof identified.id === "function" ? identified.id() : Promise.resolve(undefined);
}
export class ReplicateResultProcessor {
    private log(message: string, level: LOG_LEVEL = LOG_LEVEL_INFO) {
        Logger(`[ReplicateResultProcessor] ${message}`, level);
    }
    private logError(e: unknown) {
        Logger(e, LOG_LEVEL_VERBOSE);
    }
    private reportVaultReflectionFailure(entry: MetaEntry, cause?: unknown) {
        this.log(
            `Live replication could not reflect ${this.getPath(entry)} from the local database to the Vault; this path remains eligible for a later Vault scan.`,
            LOG_LEVEL_VERBOSE
        );
        if (cause !== undefined) this.logError(cause);
        Logger($msg("Ui.Common.SomeFilesCouldNotBeSynchronised"), LOG_LEVEL_NOTICE);
    }
    constructor(private readonly context: ReplicateResultProcessorContext) {}

    private get localDatabase() {
        return this.context.getLocalDatabase();
    }
    private get services() {
        return this.context.services;
    }

    getPath(entry: AnyEntry): string {
        return this.services.path.getPath(entry);
    }

    public suspend() {
        this._suspended = true;
        this.updateProcessingActivity();
    }
    public resume() {
        this._suspended = false;
        this.updateProcessingActivity();
        fireAndForget(() => this.runProcessQueue());
    }

    // Whether the processing is suspended
    // If true, the processing queue processor bails the loop.
    private _suspended: boolean = false;

    // A temporary lifecycle resume cannot make an unknown remote format safe to apply.
    private _compatibilityBlocked = false;
    private _assessingDatabase = false;
    private _physicalDatabase?: PouchDB.Database<EntryDoc>;
    private _observedFeatures = new Set<string>();
    private _highestObservedVersion = 0;
    private _invalidControlObserved = false;

    public get isCompatibilityBlocked() {
        return this._compatibilityBlocked;
    }

    private refreshPhysicalDatabase() {
        const current = this.localDatabase.localDatabase;
        if (current === this._physicalDatabase) return;
        if (this._physicalDatabase) {
            this._compatibilityBlocked = false;
            this._assessingDatabase = true;
            this._observedFeatures.clear();
            this._highestObservedVersion = 0;
            this._invalidControlObserved = false;
            this._queuedChanges = [];
            this._processingChanges = [];
            this._restoreFromSnapshot = undefined;
            this.updateProcessingActivity();
        }
        this._physicalDatabase = current;
    }

    private shouldStopApplication(sourceDatabase: PouchDB.Database<EntryDoc>) {
        return (
            this._compatibilityBlocked || this._assessingDatabase || sourceDatabase !== this.localDatabase.localDatabase
        );
    }

    private blockForIncompatibleVersion(document: unknown, recordObservation = true) {
        const assessment = assessRemoteFeatureDocument(document);
        const hadObservedVersion = this._highestObservedVersion > 0;
        let newFeaturesAdded = false;
        if (recordObservation) {
            let changed = false;
            if (assessment.status === "invalid-control") {
                changed = !this._invalidControlObserved;
                this._invalidControlObserved = true;
            } else {
                const version = (document as EntryVersionInfo).version;
                if (version > this._highestObservedVersion) {
                    this._highestObservedVersion = version;
                    changed = true;
                }
                if (assessment.status === "supported" || assessment.status === "unknown-features") {
                    for (const feature of assessment.status === "supported"
                        ? assessment.usedFeatures
                        : ((document as EntryVersionInfo).used_features ?? [])) {
                        if (this._observedFeatures.has(feature)) continue;
                        this._observedFeatures.add(feature);
                        changed = true;
                        newFeaturesAdded = true;
                    }
                }
            }
            if (changed) this.triggerTakeSnapshot();
        }
        if (assessment.status === "supported" || assessment.status === "older-generation") {
            // A live writer must recheck the shared Tweak policy after another
            // client starts using a newly declared representation.
            if (
                assessment.status === "supported" &&
                hadObservedVersion &&
                newFeaturesAdded &&
                !this._assessingDatabase
            ) {
                this.context.requestActiveReplicatorRetirement();
            }
            return;
        }
        if (this._compatibilityBlocked) return;
        this._compatibilityBlocked = true;
        this.updateProcessingActivity();
        this.log(describeRemoteFeatureRejection(assessment), LOG_LEVEL_NOTICE);
        this.context.requestActiveReplicatorRetirement();
    }

    /**
     * Whether the application accepts replicated documents being applied.
     *
     * Remediation mode refuses the reconciliation scan which readiness depends upon, so the
     * application stays unready for as long as the modification-time limit is configured.
     * Applying the received documents is what that mode exists for, and `parseDocumentChange` keeps
     * each one within the limit, so readiness is not required while the mode is active.
     */
    private get acceptsResultApplication() {
        if (this.services.appLifecycle.isReady()) return true;
        if (this.context.currentSettings().maxMTimeForReflectEvents <= 0) return false;
        // A fetch resets the local database, and a remote which reflects while fetching leaves this
        // processor unsuspended throughout. A document applied then cannot gather its chunks and is
        // dropped, so the database itself must still be usable.
        return this.services.database.isDatabaseReady();
    }

    public get isSuspended() {
        return (
            this._suspended ||
            this._compatibilityBlocked ||
            this._assessingDatabase ||
            !this.acceptsResultApplication ||
            this.context.currentSettings().suspendParseReplicationResult ||
            this.services.appLifecycle.isSuspended()
        );
    }

    /**
     * Take a snapshot of the current processing state.
     * This snapshot is stored in the KV database for recovery on restart.
     */
    private _snapshotWriter: Promise<void> = Promise.resolve();

    protected _takeSnapshot(): Promise<void> {
        // A blocked-batch flush must follow any earlier throttled write, or an
        // older snapshot could replace the queue after the replication callback.
        const write = this._snapshotWriter
            .catch((): void => undefined)
            .then(async () => {
                const physicalDatabase = this.localDatabase.localDatabase;
                const databaseId = await getPhysicalDatabaseId(physicalDatabase);
                if (physicalDatabase !== this.localDatabase.localDatabase) return;
                const snapshot = {
                    ...(databaseId ? { databaseId } : {}),
                    observedFeatures: [...this._observedFeatures],
                    highestObservedVersion: this._highestObservedVersion,
                    invalidControlObserved: this._invalidControlObserved,
                    queued: this._queuedChanges.slice(),
                    processing: this._processingChanges.slice(),
                } satisfies ReplicateResultProcessorState;
                await this.context.getKeyValueDB().set(KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT, snapshot);
                this.log(
                    `Snapshot taken. Queued: ${snapshot.queued.length}, Processing: ${snapshot.processing.length}`,
                    LOG_LEVEL_DEBUG
                );
                this.reportStatus();
            });
        this._snapshotWriter = write;
        return write;
    }

    public async persistBlockedSnapshot(): Promise<void> {
        if (this._compatibilityBlocked) await this._takeSnapshot();
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
        const physicalDatabase = this.localDatabase.localDatabase;
        // Replication may have checkpointed a version document before its accompanying
        // file changes reached the Vault. Assess the persisted requirement first.
        let versionInfo: unknown;
        try {
            versionInfo = await this.localDatabase.getRaw(VERSIONING_DOCID);
        } catch (error) {
            if (!isNotFoundError(error)) throw error;
        }
        if (physicalDatabase !== this.localDatabase.localDatabase) return;
        const snapshot = await this.context
            .getKeyValueDB()
            .get<ReplicateResultProcessorState>(KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT);
        if (physicalDatabase !== this.localDatabase.localDatabase) return;
        const databaseId = await getPhysicalDatabaseId(physicalDatabase);
        if (snapshot && (!snapshot.databaseId || !databaseId || snapshot.databaseId === databaseId)) {
            for (const feature of snapshot.observedFeatures ?? []) this._observedFeatures.add(feature);
            this._highestObservedVersion = Math.max(this._highestObservedVersion, snapshot.highestObservedVersion ?? 0);
            this._invalidControlObserved ||= snapshot.invalidControlObserved === true;
        }
        if (versionInfo !== undefined) this.blockForIncompatibleVersion(versionInfo);
        if (this._invalidControlObserved) this.blockForIncompatibleVersion(null, false);
        if (this._highestObservedVersion > 0) {
            this.blockForIncompatibleVersion(
                {
                    _id: VERSIONING_DOCID,
                    type: "versioninfo",
                    version: this._highestObservedVersion,
                    ...(this._highestObservedVersion >= REMOTE_FEATURE_GENERATION
                        ? { used_features: [...this._observedFeatures] }
                        : {}),
                },
                false
            );
        }
        if (snapshot && (!snapshot.databaseId || !databaseId || snapshot.databaseId === databaseId)) {
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
        this._assessingDatabase = false;
        this.updateProcessingActivity();
        this.triggerProcessQueue();
    }

    private _restoreFromSnapshot: Promise<void> | undefined = undefined;

    /**
     * Restore from snapshot only once.
     * @returns Promise that resolves when restoration is complete.
     */
    public restoreFromSnapshotOnce() {
        this.refreshPhysicalDatabase();
        if (!this._restoreFromSnapshot) {
            this._assessingDatabase = true;
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
        this.services.replication.replicationResultCount.value =
            this._queuedChanges.length + this._processingChanges.length;
    }

    /**
     * Enqueue all the given changes for processing.
     * @param changes Changes to enqueue
     */

    public enqueueAll(changes: PouchDB.Core.ExistingDocument<EntryDoc>[], sourceDatabase?: PouchDB.Database<EntryDoc>) {
        if (sourceDatabase && sourceDatabase !== this.localDatabase.localDatabase) return;
        const previousPhysicalDatabase = this._physicalDatabase;
        this.refreshPhysicalDatabase();
        if (previousPhysicalDatabase && previousPhysicalDatabase !== this._physicalDatabase) {
            fireAndForget(() => this.restoreFromSnapshotOnce());
        }
        // Inspect every control document before a note in this batch can start applying.
        for (const change of changes) {
            if (change?._id === VERSIONING_DOCID) this.blockForIncompatibleVersion(change);
        }
        for (const change of changes) {
            // Check if the change is not a document change (e.g., chunk, versioninfo, syncinfo), and processed it directly.
            const isProcessed = this.processIfNonDocumentChange(change);
            if (!isProcessed) {
                this.enqueueChange(change);
            }
        }
    }

    /**
     * Requeues stored normal-file metadata after its reflection filters change.
     * Replication checkpoints may already cover documents which were skipped
     * by the previous filter, so a later ordinary sync cannot emit them again.
     */
    public async reprocessStoredDocuments(): Promise<number> {
        let count = 0;
        let batch: PouchDB.Core.ExistingDocument<EntryDoc>[] = [];
        for await (const document of this.localDatabase.findAllNormalDocs()) {
            batch.push(document);
            count++;
            if (batch.length < REPROCESS_BATCH_SIZE) continue;
            this.enqueueAll(batch);
            batch = [];
        }
        if (batch.length > 0) this.enqueueAll(batch);
        this.log(`Requeued ${count} stored document(s) after the reflection filters changed`, LOG_LEVEL_INFO);
        return count;
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
        if (change._id === VERSIONING_DOCID) {
            this.log(`Version info document received: ${change._id}`, LOG_LEVEL_VERBOSE);
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

    private _processingActivity?: Promise<void>;
    private _processingActivityDone?: PromiseWithResolvers<void>;

    private updateProcessingActivity() {
        if (this.isSuspended) {
            this._processingActivityDone?.resolve();
            return;
        }
        const hasPendingDocuments = this._queuedChanges.length > 0 || this._processingChanges.length > 0;
        if (!hasPendingDocuments) {
            this._processingActivityDone?.resolve();
            return;
        }
        if (this._processingActivity) return;

        const activityDone = promiseWithResolvers<void>();
        this._processingActivityDone = activityDone;
        this._processingActivity = this.context
            .runLocalApplicationActivity(() => activityDone.promise, {
                label: "replicated-document-application",
            })
            .catch((error) => this.logError(error))
            .finally(() => {
                if (this._processingActivityDone === activityDone) this._processingActivityDone = undefined;
                this._processingActivity = undefined;
                this.updateProcessingActivity();
            });
    }

    /**
     * Enqueue the given document change for processing.
     * @param doc Document change to enqueue
     * @returns
     */
    protected enqueueChange(doc: PouchDB.Core.ExistingDocument<EntryDoc>) {
        const old = this._queuedChanges.find((e) => e._id == doc._id);
        const path = "path" in doc ? this.getPath(doc) : "<unknown>";
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
        this.updateProcessingActivity();
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
                if (this.isSuspended) break;
                // Dequeue the next change
                const doc = this._queuedChanges.shift();
                if (doc) {
                    this._processingChanges.push(doc);
                    void this.parseDocumentChange(doc, this.localDatabase.localDatabase);
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
    async parseDocumentChange(
        change: PouchDB.Core.ExistingDocument<EntryDoc>,
        sourceDatabase: PouchDB.Database<EntryDoc> = this.localDatabase.localDatabase
    ) {
        try {
            if (this.shouldStopApplication(sourceDatabase)) return;
            if (isAnyNote(change)) {
                const docMtime = change.mtime ?? 0;
                const maxMTime = this.context.currentSettings().maxMTimeForReflectEvents;
                if (maxMTime > 0 && docMtime > maxMTime) {
                    const docPath = this.getPath(change);
                    this.log(
                        `Processing ${docPath} has been skipped due to modification time (${new Date(
                            docMtime * 1000
                        ).toISOString()}) exceeding the limit`,
                        LOG_LEVEL_INFO
                    );
                    return;
                }
            }
            // If the document is a virtual document, process it in the virtual document processor.
            if (await this.services.replication.processVirtualDocument(change)) return;
            if (this.shouldStopApplication(sourceDatabase)) return;
            // If the document is version info, check compatibility and return.
            if (isAnyNote(change)) {
                const docPath = this.getPath(change);
                if (!(await this.services.vault.isTargetFile(docPath))) {
                    this.log(`Skipped: ${docPath}`, LOG_LEVEL_VERBOSE);
                    return;
                }
                if (this.shouldStopApplication(sourceDatabase)) return;
                const size = change.size;
                // Note that this size check depends size that in metadata, not the actual content size.
                if (this.services.vault.isFileSizeTooLarge(size)) {
                    this.log(
                        `Processing ${docPath} has been skipped due to file size exceeding the limit`,
                        LOG_LEVEL_NOTICE
                    );
                    return;
                }
                return await this.applyToDatabase(change, sourceDatabase);
            }
            this.log(`Skipped unexpected non-note document: ${change._id}`, LOG_LEVEL_INFO);
            return;
        } finally {
            // An in-flight parse may have started before the control document arrived.
            // Retain it even if a later asynchronous boundary stopped application.
            if (
                this._compatibilityBlocked &&
                sourceDatabase === this.localDatabase.localDatabase &&
                !this._queuedChanges.includes(change)
            ) {
                this._queuedChanges.push(change);
            }
            // Remove from processing queue
            this._processingChanges = this._processingChanges.filter((e) => e !== change);
            try {
                if (this._queuedChanges.length === 0 && this._processingChanges.length === 0) {
                    try {
                        await this._takeSnapshot();
                    } catch (error) {
                        this.logError(error);
                    }
                } else {
                    this.triggerTakeSnapshot();
                }
            } finally {
                this.updateProcessingActivity();
            }
        }
    }

    // Phase 2: apply the document to database
    protected applyToDatabase(
        doc: PouchDB.Core.ExistingDocument<AnyEntry>,
        sourceDatabase: PouchDB.Database<EntryDoc> = this.localDatabase.localDatabase
    ) {
        return this.withCounting(async () => {
            let releaser: Awaited<ReturnType<typeof this._semaphore.acquire>> | undefined = undefined;
            try {
                releaser = await this._semaphore.acquire();
                if (this.shouldStopApplication(sourceDatabase)) return;
                await this._applyToDatabase(doc, sourceDatabase);
            } catch (e) {
                this.log(`Error while processing replication result`, LOG_LEVEL_NOTICE);
                this.logError(e);
            } finally {
                // Remove from processing queue (To remove from "in-progress" list, and snapshot will not include it)
                if (releaser) {
                    releaser();
                }
            }
        }, this.services.replication.databaseQueueCount);
    }
    // Phase 2.1: process the document and apply to storage
    // This function is serialized per document to avoid race-condition for the same document.
    private _applyToDatabase(
        doc_: PouchDB.Core.ExistingDocument<AnyEntry>,
        sourceDatabase: PouchDB.Database<EntryDoc>
    ) {
        const dbDoc = doc_ as LoadedEntry; // It has no `data`
        const path = this.getPath(dbDoc);
        return serialized(`replication-process:${dbDoc._id}`, async () => {
            const docNote = `${path} (${shortenId(dbDoc._id)}, ${shortenRev(dbDoc._rev)})`;
            const isRequired = await this.checkIsChangeRequiredForDatabaseProcessing(dbDoc);
            if (this.shouldStopApplication(sourceDatabase)) return;
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
            if (this.shouldStopApplication(sourceDatabase)) return;
            if (!doc) {
                // Failed to gather content
                this.log(`Failed to gather content of ${docNote}`, LOG_LEVEL_NOTICE);
                return;
            }
            // Check if other processor wants to process this document, if so, skip processing here.
            if (await this.services.replication.processOptionalSynchroniseResult(dbDoc)) {
                // Already processed
                this.log(`Processed by other processor: ${docNote}`, LOG_LEVEL_DEBUG);
            } else if (this.services.vault.isValidPath(this.getPath(doc))) {
                if (this.shouldStopApplication(sourceDatabase)) return;
                // Apply to storage if the path is valid
                try {
                    const reflected = await this.applyToStorage(doc as MetaEntry, sourceDatabase);
                    if (!reflected) {
                        this.reportVaultReflectionFailure(doc as MetaEntry);
                        return;
                    }
                    this.log(`Processed: ${docNote}`, LOG_LEVEL_DEBUG);
                } catch (error) {
                    this.reportVaultReflectionFailure(doc as MetaEntry, error);
                }
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
    protected applyToStorage(
        entry: MetaEntry,
        sourceDatabase: PouchDB.Database<EntryDoc> = this.localDatabase.localDatabase
    ) {
        return this.withCounting(
            () =>
                this.shouldStopApplication(sourceDatabase)
                    ? Promise.resolve(false)
                    : this.services.replication.processSynchroniseResult(entry),
            this.services.replication.storageApplyingCount
        );
    }

    /**
     * Check whether processing is required for the given document.
     * @param dbDoc Document to check
     * @returns True if processing is required; false otherwise
     */
    protected async checkIsChangeRequiredForDatabaseProcessing(dbDoc: LoadedEntry): Promise<boolean> {
        const path = this.getPath(dbDoc);
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
        } catch (e) {
            if (isNotFoundError(e)) {
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
