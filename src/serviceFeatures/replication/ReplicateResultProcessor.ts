import {
    assessRemoteFeatureDocument,
    describeRemoteFeatureRejection,
    NFC_PATH_IDENTITY_FEATURE,
    type ContentReadFailure,
    ContentReadError,
} from "@vrtmrz/livesync-commonlib/replication";
import { getPathNormalizationVersion } from "@vrtmrz/livesync-commonlib/settings";
import {
    SYNCINFO_ID,
    VERSIONING_DOCID,
    type AnyEntry,
    type DocumentID,
    type EntryDoc,
    type EntryLeaf,
    type LoadedEntry,
    type MetaEntry,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
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
import { withCounting } from "octagonal-wheels/concurrency/counting";
import { withLock } from "octagonal-wheels/concurrency/lock";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive_v2";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { isNotFoundError } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
import type PouchDB from "pouchdb-core";
import { promiseWithResolvers, type PromiseWithResolvers } from "octagonal-wheels/promises";
import { $msg } from "@/common/translation";
import { withScope, type Scope } from "octagonal-wheels/resource/scope";
import type { ReflectionOperationContext } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler";
import {
    applyReplicatedDocument,
    checkDocumentRevision,
    type ReplicatedDocumentApplicationContext,
} from "./applyReplicatedDocument";

import {
    ReflectionTargets,
    type PendingReflectionRecord,
    type RecoveryAttempt,
    type RecoveryResource,
    type ReflectionApplicationScope,
    type ReflectionRecoveryView,
    type ReflectionSnapshot,
} from "./reflectionTargets";

const KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT = "replicationResultProcessorSnapshot";
const REPROCESS_BATCH_SIZE = 100;
type ReplicateResultProcessorSettings = Pick<
    ObsidianLiveSyncSettings,
    "maxMTimeForReflectEvents" | "suspendParseReplicationResult"
> & { pathNormalizationVersion?: 0 | 1 };
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
    readonly onVaultReflectionFailure?: () => void;
    readonly canRetainFailedReflection?: () => boolean;
    readonly canRetryResource?: (resource: RecoveryResource) => boolean;
    readonly inspectReflection?: (
        entry: LoadedEntry,
        source: PendingReflectionRecord["source"]
    ) => Promise<"reflected" | "policy" | "pending">;
    readonly reconcileScannedDocument?: (entry: LoadedEntry, operation: ReflectionOperationContext) => Promise<unknown>;
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
type ReplicateResultProcessorState = ReflectionSnapshot & {
    queued: PouchDB.Core.ExistingDocument<EntryDoc>[];
    processing: PouchDB.Core.ExistingDocument<EntryDoc>[];
};

export type { PendingReflection, ReflectionRecoveryView } from "./reflectionTargets";

function shortenId(id: string): string {
    return id.length > 10 ? id.substring(0, 10) : id;
}
function shortenRev(rev: string | undefined): string {
    if (!rev) return "undefined";
    return rev.length > 10 ? rev.substring(0, 10) : rev;
}
export class ReplicateResultProcessor {
    private readonly reflectionTargets = new ReflectionTargets({
        canRetainFailures: () => this.context.canRetainFailedReflection?.() === true,
        canRetryResource: (resource) => this.context.canRetryResource?.(resource) === true,
        isApplicationReady: () => this.services.appLifecycle.isReady(),
        isWaitingForReset: () => this.waitingForDatabaseReset,
        onListenerError: (error) => this.logError(error),
    });
    private snapshotWrites: Promise<void> = Promise.resolve();
    private snapshotRequestVersion = 0;
    private savedSnapshotVersion = 0;
    private readonly recoveryAdmissionLock = Symbol("reflection-recovery-admission");

    readonly recovery: ReflectionRecoveryView = {
        list: () => this.reflectionTargets.list(),
        retry: (ids) => this.scheduleRecovery("manual", ids),
        reconcile: () => this.reconcilePendingReflections(),
        onChanged: (listener) => this.reflectionTargets.onChanged(listener),
    };

    /**
     * Register initialisation-scan failures while readiness holds receiver dispatch and recovery admission.
     * The scanner awaits this callback before releasing that hold. Received operations instead capture
     * their target identity before reading, so their late failures cannot replace newer pending work.
     */
    public async registerReflectionFailure(
        target: ReflectionOperationContext["target"],
        error: unknown,
        source: PendingReflectionRecord["source"]
    ): Promise<void> {
        const scope = this.reflectionTargets.issue(target.documentId, undefined, source);
        await this.retainReflectionFailure(target, error, scope);
    }

    private async retainReflectionFailure(
        target: ReflectionOperationContext["target"],
        error: unknown,
        scope: ReflectionApplicationScope
    ): Promise<void> {
        const resources = error instanceof ContentReadError ? error.failure.resources : [];
        await this.retainContentReadFailure({ ...target, resources, cause: error }, scope);
    }

    private async retainContentReadFailure(
        failure: ContentReadFailure,
        scope: ReflectionApplicationScope,
        currentRevision?: string
    ): Promise<void> {
        if (!this.reflectionTargets.acceptsFailure(failure)) {
            return;
        }
        await this.restoreFromSnapshotOnce();
        const target = scope.retainFailure(failure, currentRevision);
        if (target) {
            await this.saveRecoveryState(target);
        }
    }

    private async saveRecoveryState(target?: PendingReflectionRecord): Promise<void> {
        try {
            await this._takeSnapshot();
        } catch (error) {
            this.reflectionTargets.markForReview(target, "snapshot-save-failed");
            throw error;
        }
    }

    private pendingInspectionFailed(target: PendingReflectionRecord, error: unknown): void {
        if (!this.reflectionTargets.isCurrent(target)) {
            return;
        }
        if (isNotFoundError(error)) {
            this.reflectionTargets.remove(target);
        } else {
            this.logError(error);
            this.reflectionTargets.markForReview(target, "unavailable");
        }
    }

    /** Read current Metadata and filters without inspecting Vault contents or provenance. */
    private async readPendingMetadata(target: PendingReflectionRecord): Promise<LoadedEntry | undefined> {
        const scope = this.reflectionTargets.inspect(target);
        return scope
            .run(async () => {
                scope.checkpoint();
                const selected = this.services.database.localDatabaseDirect;
                let current;
                try {
                    current = await this.localDatabase.getRaw<LoadedEntry>(target.documentId as DocumentID, {
                        conflicts: true,
                    });
                } catch (error) {
                    if (isNotFoundError(error)) {
                        throw error;
                    }
                    if (this.reflectionTargets.isCurrent(target)) {
                        this.logError(error);
                        this.reflectionTargets.issue(target.documentId, undefined, target.source).retainFailure({
                            documentId: target.documentId as DocumentID,
                            revision: target.revision,
                            resources: ["local-database"],
                            cause: error,
                        });
                        // The caller persists the changed target; recovery must not wait on this inspection.
                        if (selected) {
                            fireAndForget(() => this.services.database.onLocalDatabaseError(selected, error));
                        }
                    }
                    return;
                }
                scope.checkpoint();
                if (current._rev !== target.revision || !isAnyNote(current)) {
                    this.reflectionTargets.remove(target);
                    return;
                }
                const path = this.getPath(current);
                const targetFile = await this.services.vault.isTargetFile(path);
                scope.checkpoint();
                if (!targetFile || this.services.vault.isFileSizeTooLarge(current.size)) {
                    this.reflectionTargets.remove(target);
                    return;
                }
                return current;
            })
            .catch((error: unknown): undefined => {
                this.pendingInspectionFailed(target, error);
                return undefined;
            });
    }

    /** Confirm completion or the existing reflection policy only when executing or reconciling. */
    private async currentPendingEntry(target: PendingReflectionRecord): Promise<LoadedEntry | undefined> {
        const scope = this.reflectionTargets.inspect(target);
        return scope
            .run(async () => {
                const current = await this.readPendingMetadata(target);
                if (!current) {
                    return;
                }
                scope.checkpoint();
                const disposition = await this.context.inspectReflection?.(current, target.source);
                scope.checkpoint();
                if (disposition === "reflected" || disposition === "policy") {
                    this.log(
                        `Retired pending reflection (${disposition}): ${this.getPath(current)}`,
                        LOG_LEVEL_VERBOSE
                    );
                    this.reflectionTargets.remove(target);
                    return;
                }
                return current;
            })
            .catch((error: unknown): undefined => {
                this.pendingInspectionFailed(target, error);
                return undefined;
            });
    }

    public async reconcilePendingReflections(): Promise<void> {
        await this.restoreFromSnapshotOnce();
        if (this.reflectionTargets.isStopped) {
            return;
        }
        const before = this.reflectionTargets.version;
        if (!this.reflectionTargets.hasPending) {
            return;
        }
        for (const target of this.reflectionTargets.candidates()) {
            if (!this.reflectionTargets.attempt(target.documentId, target.revision)) {
                await this.currentPendingEntry(target);
            }
        }
        if (this.reflectionTargets.version !== before) {
            await this.saveRecoveryState();
        }
    }

    public get hasPendingReflections(): boolean {
        return this.reflectionTargets.hasPending;
    }

    /** Reconcile only the retained target affected by an existing local file-change event. */
    public async reconcilePendingDocument(documentId: string): Promise<void> {
        await this.restoreFromSnapshotOnce();
        if (this.reflectionTargets.isStopped) {
            return;
        }
        const target = this.reflectionTargets.get(documentId);
        if (!target || this.reflectionTargets.attempt(documentId, target.revision)) {
            return;
        }
        const before = this.reflectionTargets.version;
        await this.currentPendingEntry(target);
        if (!this.reflectionTargets.isStopped && this.reflectionTargets.version !== before) {
            await this.saveRecoveryState();
        }
    }

    /** A matching resource recovery admits one automatic attempt per unresolved revision. */
    public async retryWaitingReflections(resource: RecoveryResource = "remote"): Promise<void> {
        await this.scheduleRecovery("automatic", undefined, resource);
    }

    /** Flush retained work before the host closes its key-value database. */
    public async stop(): Promise<void> {
        this.suspend();
        await Promise.allSettled([...this.pendingApplications]);
        this.reflectionTargets.stop();
        try {
            await this._takeSnapshot();
        } finally {
            this.reflectionTargets.clearListeners();
        }
    }

    private async scheduleRecovery(
        kind: RecoveryAttempt["kind"],
        ids?: readonly string[],
        resource: RecoveryResource = "remote"
    ): Promise<void> {
        await this.restoreFromSnapshotOnce();
        const candidates = this.reflectionTargets.candidates();
        if (this.isSuspended || candidates.length === 0) {
            return;
        }
        const selected = ids ? new Set(ids) : undefined;
        await withLock(this.recoveryAdmissionLock, async () => {
            if (this.isSuspended) {
                return;
            }
            const before = this.reflectionTargets.version;
            if (kind === "automatic") this.reflectionTargets.resourceRecovered(resource);
            const admitted = await this.admitRecoveryCandidates(candidates, kind, selected);
            if (admitted.length === 0 && this.reflectionTargets.version === before) {
                return;
            }
            this.reflectionTargets.notifyChanged();
            // Persist all consumed allowances together before any of this batch can execute.
            try {
                await this.saveRecoveryState();
            } catch (error) {
                for (const { attempt } of admitted) {
                    this.reflectionTargets.finishAttempt(attempt, "snapshot-save-failed");
                }
                throw error;
            }
            await this.enqueueRecoveryAttempts(admitted);
        });
    }

    private async admitRecoveryCandidates(
        candidates: readonly PendingReflectionRecord[],
        kind: RecoveryAttempt["kind"],
        selected?: ReadonlySet<string>
    ): Promise<{ attempt: RecoveryAttempt; entry: LoadedEntry }[]> {
        const admitted: { attempt: RecoveryAttempt; entry: LoadedEntry }[] = [];
        for (const target of candidates) {
            if ((selected && !selected.has(target.documentId)) || !this.reflectionTargets.canAdmit(target, kind)) {
                continue;
            }
            const entry = await this.readPendingMetadata(target);
            if (!entry || this.isSuspended) {
                continue;
            }
            const attempt = this.reflectionTargets.admit(target, kind);
            if (attempt) {
                admitted.push({ attempt, entry });
            }
        }
        return admitted;
    }

    private async enqueueRecoveryAttempts(
        admitted: readonly { attempt: RecoveryAttempt; entry: LoadedEntry }[]
    ): Promise<void> {
        let interrupted = false;
        for (const { attempt, entry } of admitted) {
            if (this.isSuspended || !this.reflectionTargets.isCurrentAttempt(attempt)) {
                this.reflectionTargets.finishAttempt(attempt, "interrupted");
                interrupted = true;
            } else {
                this.enqueueChange(entry as PouchDB.Core.ExistingDocument<EntryDoc>);
            }
        }
        if (interrupted) {
            await this.saveRecoveryState();
        }
    }

    private log(message: string, level: LOG_LEVEL = LOG_LEVEL_INFO) {
        Logger(`[ReplicateResultProcessor] ${message}`, level);
    }
    private logError(e: unknown) {
        Logger(e, LOG_LEVEL_VERBOSE);
    }
    private reportVaultReflectionFailure(entry: MetaEntry, cause?: unknown) {
        this.context.onVaultReflectionFailure?.();
        this.log(
            `Live replication could not reflect ${this.getPath(entry)} from the local database to the Vault; this path remains eligible for a later Vault scan.`,
            LOG_LEVEL_VERBOSE
        );
        if (cause !== undefined) this.logError(cause);
        Logger($msg("Ui.Common.SomeFilesCouldNotBeSynchronised"), LOG_LEVEL_NOTICE);
    }
    constructor(
        private readonly context: ReplicateResultProcessorContext,
        private waitingForDatabaseReset = false
    ) {}

    /** Discard old reflection work only after the requested startup database replacement succeeds. */
    public async completeStartupDatabaseReset(): Promise<void> {
        const reset = this.reflectionTargets.beginReset();
        const previousQueue = this._queuedChanges;
        this._queuedChanges = this._queuedChanges.filter((entry) => reset.keepQueued(entry._id, entry._rev));
        this.reflectionTargets.notifyChanged();
        try {
            await this._takeSnapshot();
        } catch (error) {
            reset.rollback();
            this._queuedChanges = [
                ...previousQueue,
                ...this._queuedChanges.filter((entry) => !previousQueue.includes(entry)),
            ];
            this.reflectionTargets.notifyChanged();
            this.reportStatus();
            this.updateProcessingActivity();
            throw error;
        }
        this.updateProcessingActivity();
        if (!this.waitingForDatabaseReset) return;
        this._restoreFromSnapshot = Promise.resolve();
        this.waitingForDatabaseReset = false;
        this.continueHeldDocuments();
    }

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
        this.continueHeldDocuments();
    }

    private databaseRecoveryPaused = false;
    private readonly pendingApplications = new Set<Promise<unknown>>();

    /** Hold dispatch while the current local database lifetime is replaced. */
    public async pauseForDatabaseRecovery(): Promise<void> {
        this.databaseRecoveryPaused = true;
        this.updateProcessingActivity();
        await Promise.allSettled([...this.pendingApplications]);
        await this._takeSnapshot();
    }

    public resumeAfterDatabaseRecovery(): void {
        this.databaseRecoveryPaused = false;
        this.continueHeldDocuments();
    }
    /**
     * Continue the queued documents which were held, for example while the application was not ready.
     * An explicit suspension, by `suspend()` or by the settings, remains in effect.
     */
    public continueHeldDocuments() {
        this.updateProcessingActivity();
        this.triggerProcessQueue();
    }

    // Whether the processing is suspended
    // If true, the processing queue processor bails the loop.
    private _suspended: boolean = false;

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
            this.waitingForDatabaseReset ||
            this.databaseRecoveryPaused ||
            !this.services.database.isDatabaseReady() ||
            this.reflectionTargets.isStopped ||
            this._suspended ||
            !this.acceptsResultApplication ||
            this.context.currentSettings().suspendParseReplicationResult ||
            this.services.appLifecycle.isSuspended()
        );
    }

    /**
     * Take a snapshot of the current processing state.
     * This snapshot is stored in the KV database for recovery on restart.
     */
    protected _takeSnapshot(): Promise<void> {
        const requested = ++this.snapshotRequestVersion;
        const write = this.snapshotWrites
            .catch((): void => {})
            .then(async () => {
                // An unread snapshot may contain unfinished work absent from this instance.
                await this.restoreFromSnapshotOnce();
                if (this.savedSnapshotVersion >= requested) {
                    return;
                }
                const version = this.snapshotRequestVersion;
                const snapshot: ReplicateResultProcessorState = {
                    queued: this._queuedChanges.slice(),
                    processing: this._processingChanges.slice(),
                    ...this.reflectionTargets.snapshot(),
                };
                await this.context.getKeyValueDB().set(KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT, snapshot);
                this.savedSnapshotVersion = version;
                this.log(
                    `Snapshot taken. Queued: ${snapshot.queued.length}, Processing: ${snapshot.processing.length}`,
                    LOG_LEVEL_DEBUG
                );
                this.reportStatus();
            });
        this.snapshotWrites = write;
        return write;
    }
    /**
     * Trigger taking a snapshot.
     */
    protected _triggerTakeSnapshot() {
        fireAndForget(async () => {
            try {
                await this._takeSnapshot();
            } catch (error) {
                this.logError(error);
            }
        });
    }
    /**
     * Throttled version of triggerTakeSnapshot.
     */
    protected triggerTakeSnapshot = throttle(() => this._triggerTakeSnapshot(), 50);

    /**
     * Restore from snapshot.
     */
    public async restoreFromSnapshot() {
        if (this.waitingForDatabaseReset) return;
        const snapshot = await this.context
            .getKeyValueDB()
            .get<ReplicateResultProcessorState>(KV_KEY_REPLICATION_RESULT_PROCESSOR_SNAPSHOT);
        if (snapshot) {
            const keepQueued = this.reflectionTargets.restore(snapshot);
            // Consumed recovery attempts remain review work; ordinary queued work can resume.
            const restored = [...snapshot.processing, ...snapshot.queued].filter((entry) =>
                keepQueued(entry._id, entry._rev)
            );
            const newQueue = [...restored, ...this._queuedChanges];
            this._queuedChanges = [];
            this.enqueueAll(newQueue);
            this.reflectionTargets.notifyChanged();
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
        if (this.waitingForDatabaseReset) return Promise.resolve();
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
        return withCounting(countValue, proc);
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
        if (change._id === VERSIONING_DOCID || change.type === "versioninfo") {
            this.log(`Version info document received: ${change._id}`, LOG_LEVEL_VERBOSE);
            const assessment = assessRemoteFeatureDocument(change);
            const pathIdentityDoesNotMatch =
                assessment.status === "supported" &&
                assessment.usedFeatures.includes(NFC_PATH_IDENTITY_FEATURE) !==
                    (getPathNormalizationVersion(this.context.currentSettings()) === 1);
            if (
                (assessment.status !== "supported" && assessment.status !== "older-generation") ||
                pathIdentityDoesNotMatch
            ) {
                // Fence and retire the active publication through its owner.
                this.context.requestActiveReplicatorRetirement();
                const rejection = pathIdentityDoesNotMatch
                    ? "Local and remote path identity settings do not match. Select the matching mode and Fetch the migrated database before synchronising."
                    : `${describeRemoteFeatureRejection(assessment)} Update Self-hosted LiveSync before synchronising.`;
                this.log(rejection, LOG_LEVEL_NOTICE);
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
        if (this.waitingForDatabaseReset) return;
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
                const interrupted = this.reflectionTargets.attempt(old._id, old._rev);
                if (interrupted && !interrupted.started) {
                    this.reflectionTargets.finishAttempt(interrupted, "interrupted");
                }
                this.log(`[Enqueue] requeued: ${docNote} (from rev: ${shortenRev(oldRev)})`, LOG_LEVEL_VERBOSE);
            }
        }
        // Enqueue the change
        this._queuedChanges.push(doc);
        this.reportStatus();
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
                if (this.isSuspended) {
                    break;
                }
                // Dequeue the next change
                const doc = this._queuedChanges.shift();
                if (doc) {
                    this._processingChanges.push(doc);
                    void this.parseDocumentChange(doc).catch((error) => this.logError(error));
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
        const operation = withScope(change, (resources) => this.parseDocumentChangeAndSaveSnapshot(change, resources));
        this.pendingApplications.add(operation);
        try {
            return await operation;
        } finally {
            this.pendingApplications.delete(operation);
        }
    }

    private async parseDocumentChangeAndSaveSnapshot(
        change: PouchDB.Core.ExistingDocument<EntryDoc>,
        resources: Scope<unknown>
    ) {
        const queuedChange = change;
        const recoveryAttempt = this.reflectionTargets.startAttempt(change._id, change._rev);
        const targetScope = this.reflectionTargets.issue(change._id, recoveryAttempt);
        const selectedDatabase = this.services.database.localDatabaseDirect;
        try {
            await targetScope.run(() =>
                this.applyCurrentDocumentChange(change, targetScope, resources, recoveryAttempt)
            );
        } catch (error) {
            // The input target owns retention, even if reading a historical revision failed.
            // Save first; recovery can drain this attempt and must not be awaited here.
            try {
                if (isAnyNote(change)) {
                    await this.retainReflectionFailure(
                        { documentId: change._id, revision: change._rev },
                        error,
                        targetScope
                    );
                }
            } finally {
                if (
                    selectedDatabase &&
                    error instanceof ContentReadError &&
                    (error.failure.resources.includes("local-database") || error.failure.resources.length === 0)
                ) {
                    fireAndForget(() => this.services.database.onLocalDatabaseError(selectedDatabase, error));
                }
                this.reportVaultReflectionFailure(change as MetaEntry, error);
            }
        } finally {
            if (recoveryAttempt) {
                this.reflectionTargets.finishAttempt(recoveryAttempt);
            }
            // Remove from processing queue
            this._processingChanges = this._processingChanges.filter((e) => e !== queuedChange);
            // Queue visibility must not wait for persisting a recovery snapshot. Consumers
            // use this count to decide whether the reflected Vault is ready for interaction.
            this.reportStatus();
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

    private async applyCurrentDocumentChange(
        change: PouchDB.Core.ExistingDocument<EntryDoc>,
        scope: ReflectionApplicationScope,
        resources: Scope<unknown>,
        recoveryAttempt?: RecoveryAttempt
    ): Promise<void> {
        scope.checkpoint();
        if (recoveryAttempt) {
            const current = await this.currentPendingEntry(recoveryAttempt.target);
            if (!current) {
                return;
            }
            change = current as PouchDB.Core.ExistingDocument<EntryDoc>;
        }
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
        if (await this.services.replication.processVirtualDocument(change)) {
            return;
        }
        // If the document is version info, check compatibility and return.
        if (isAnyNote(change)) {
            const docPath = this.getPath(change);
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
            return await this.applyToDatabase(change, resources, recoveryAttempt, scope);
        }
        this.log(`Skipped unexpected non-note document: ${change._id}`, LOG_LEVEL_INFO);
    }

    // Phase 2: apply the document to database
    protected applyToDatabase(
        doc: PouchDB.Core.ExistingDocument<AnyEntry>,
        resources: Scope<unknown>,
        recoveryAttempt?: RecoveryAttempt,
        targetScope = this.reflectionTargets.issue(doc._id, recoveryAttempt)
    ) {
        return this.withCounting(async () => {
            resources.defer(await this._semaphore.acquire());
            await this._applyToDatabase(doc, targetScope, recoveryAttempt);
        }, this.services.replication.databaseQueueCount);
    }
    private readonly documentApplication: ReplicatedDocumentApplicationContext = {
        getLocalDatabase: () => this.localDatabase,
        isValidPath: (entry) => this.services.vault.isValidPath(this.getPath(entry)),
        processOptional: (entry) => this.services.replication.processOptionalSynchroniseResult(entry),
        applyToStorage: (entry, operation) => this.applyToStorage(entry, operation),
        onReflected: async (id) => {
            const pending = this.reflectionTargets.get(id);
            if (pending) {
                await this.currentPendingEntry(pending);
            }
        },
        log: (message, level) => this.log(message, level),
    };

    // Capture the target before waiting for the per-document lock.
    private _applyToDatabase(
        doc: PouchDB.Core.ExistingDocument<AnyEntry>,
        scope: ReflectionApplicationScope,
        recoveryAttempt?: RecoveryAttempt
    ) {
        const entry = doc as LoadedEntry;
        const description = `${this.getPath(entry)} (${shortenId(entry._id)}, ${shortenRev(entry._rev)})`;
        return scope.run(() =>
            withLock(`replication-process:${entry._id}`, async () => {
                scope.checkpoint();
                if (!(await this.checkIsChangeRequiredForDatabaseProcessing(entry, scope))) {
                    this.log(`Skipped (Not latest): ${description}`, LOG_LEVEL_VERBOSE);
                    return;
                }
                scope.checkpoint();
                if (recoveryAttempt?.target.source === "scan" && this.context.reconcileScannedDocument) {
                    await this.context.reconcileScannedDocument(entry, {
                        target: { documentId: entry._id, revision: entry._rev! },
                        source: "scan",
                        checkpoint: () => {
                            scope.checkpoint();
                            return true;
                        },
                    });
                    await this.currentPendingEntry(recoveryAttempt.target);
                    return;
                }
                await applyReplicatedDocument(this.documentApplication, entry, scope, description);
            })
        );
    }

    /**
     * Phase 3: Apply the given entry to storage.
     * @param entry
     * @returns
     */
    protected applyToStorage(entry: MetaEntry, operation: ReflectionOperationContext) {
        return this.withCounting(
            () => this.services.replication.processSynchroniseResult(entry, operation),
            this.services.replication.storageApplyingCount
        );
    }

    /**
     * Check whether processing is required for the given document.
     * @param dbDoc Document to check
     * @returns True if processing is required; false otherwise
     */
    protected async checkIsChangeRequiredForDatabaseProcessing(
        dbDoc: LoadedEntry,
        scope = this.reflectionTargets.issue(dbDoc._id)
    ): Promise<boolean> {
        return checkDocumentRevision(this.documentApplication, dbDoc, scope);
    }
}
