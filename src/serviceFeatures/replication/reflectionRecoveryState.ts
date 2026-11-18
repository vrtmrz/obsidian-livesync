import type { ContentReadFailure } from "@vrtmrz/livesync-commonlib/replication";
import { isInternalMetadata } from "@vrtmrz/livesync-commonlib/compat/common/typeUtils";

/** A retained document revision, its remaining dependencies, and its finite retry allowance. */
export interface PendingReflection {
    documentId: string;
    revision: string;
    source: "scan" | "received";
    state: "waiting" | "review";
    automaticAttempted: boolean;
    /** Resources which must become usable before an automatic retry is eligible. */
    resources: readonly RecoveryResource[];
    reason: string;
    running: boolean;
}

/** Read and explicitly act on retained work without exposing mutable target ownership. */
export interface ReflectionRecoveryView {
    /** Inspect current targets; this does not admit retries or read file content. */
    list(): readonly PendingReflection[];
    /** Await admission and persistence of selected manual retries, rather than their file application. */
    retry(documentIds: readonly string[]): Promise<void>;
    /** Retire targets already reflected or excluded by policy, without applying their contents. */
    reconcile(): Promise<void>;
    /** Observe published target-state changes and return an unsubscribe function. */
    onChanged(listener: () => void): () => void;
}

type MutablePendingReflection = Omit<PendingReflection, "running" | "resources"> & { resources: RecoveryResource[] };
export type PendingReflectionRecord = Readonly<MutablePendingReflection>;
export type RecoveryResource = "remote" | "local-database";
type MutableRecoveryAttempt = {
    documentId: string;
    revision: string;
    kind: "automatic" | "manual";
    target: MutablePendingReflection;
    started: boolean;
    failureReason?: string;
};
export type RecoveryAttempt = Readonly<Omit<MutableRecoveryAttempt, "target"> & { target: PendingReflectionRecord }>;
export type ReflectionSnapshot = {
    pendingReflections?: PendingReflectionRecord[];
    recoveryAttempts?: Pick<RecoveryAttempt, "documentId" | "revision" | "kind">[];
};

interface ReflectionRecoveryStateContext {
    canRetainFailures(): boolean;
    canRetryResource(resource: RecoveryResource): boolean;
    isApplicationReady(): boolean;
    isWaitingForReset(): boolean;
    onListenerError(error: unknown): void;
}

export interface ReflectionTargetScope {
    /** Check at operation boundaries; this does not cancel an already started write. */
    checkpoint(): void;
    /** Only this scope's obsolete-target exit is consumed. I/O failures keep their identity. */
    run<T>(operation: () => Promise<T>): Promise<T | undefined>;
}

export interface ReflectionApplicationScope extends ReflectionTargetScope {
    readonly source: PendingReflectionRecord["source"];
    observeRevision(revision: string): void;
    retainFailure(failure: ContentReadFailure, currentRevision?: string): PendingReflectionRecord | undefined;
}

type FailureObservation = {
    generation: number;
    pending: PendingReflectionRecord | undefined;
    currentRevision?: string;
};

type StoredPendingReflectionHeader = Pick<
    PendingReflectionRecord,
    "documentId" | "revision" | "source" | "state" | "automaticAttempted" | "reason"
> & { resources?: unknown };

function recoveryKey(documentId: string, revision: string): string {
    return JSON.stringify([documentId, revision]);
}

/** Validate the required snapshot header while leaving optional resources untrusted for restore. */
function isStoredPendingReflectionHeader(value: unknown): value is StoredPendingReflectionHeader {
    if (!value || typeof value !== "object") {
        return false;
    }

    // Identity names the retained document revision.
    if (
        !("documentId" in value) ||
        typeof value.documentId !== "string" ||
        !("revision" in value) ||
        typeof value.revision !== "string"
    ) {
        return false;
    }

    // Source and state must be from the supported snapshot vocabulary.
    if (
        !("source" in value) ||
        (value.source !== "scan" && value.source !== "received") ||
        !("state" in value) ||
        (value.state !== "waiting" && value.state !== "review")
    ) {
        return false;
    }

    // The finite retry allowance and its reason are required before restore normalises resources.
    if (
        !("automaticAttempted" in value) ||
        typeof value.automaticAttempted !== "boolean" ||
        !("reason" in value) ||
        typeof value.reason !== "string"
    ) {
        return false;
    }

    return true;
}

function isRecoveryResource(value: unknown): value is RecoveryResource {
    return value === "local-database" || value === "remote";
}

/** Recover only dependencies represented explicitly by older snapshot reasons. */
function legacyResources(reason: string): RecoveryResource[] {
    if (reason === "local-database") {
        return ["local-database"];
    }
    if (reason === "offline" || reason === "transport") {
        return ["remote"];
    }
    return [];
}

function describeResources(resources: readonly RecoveryResource[]): string {
    return resources.length === 0 ? "unavailable" : [...new Set(resources)].sort().join(",");
}

/** Accept only explicitly known dependencies; unknown resource data stays unclassified. */
function failureResources(failure: ContentReadFailure): RecoveryResource[] {
    const resources: unknown = failure.resources;
    return Array.isArray(resources) && resources.every(isRecoveryResource) ? [...new Set(resources)].sort() : [];
}

/** Consume only this scope's own obsolete-target exit, preserving unrelated failure identity. */
function targetScope(isCurrent: () => boolean): ReflectionTargetScope {
    let obsolete: Error | undefined;
    return {
        checkpoint() {
            if (!isCurrent()) {
                obsolete ??= new Error("The reflection target is no longer current");
                throw obsolete;
            }
        },
        async run(operation) {
            try {
                return await operation();
            } catch (error) {
                if (!obsolete || error !== obsolete) {
                    throw error;
                }
            }
        },
    };
}

/** Owns pending reflection records, retry allowances, scopes, and snapshot restoration. */
export class ReflectionRecoveryState {
    private readonly pending = new Map<string, MutablePendingReflection>();
    private readonly attempts = new Map<string, MutableRecoveryAttempt>();
    private readonly listeners = new Set<() => void>();
    /** Invalidates issued scopes on reset; restoring records does not revive those scopes. */
    private generation = 0;
    /** Counts published state changes so callers can decide whether another snapshot is needed. */
    private changeVersion = 0;
    private stopped = false;

    constructor(private readonly context: ReflectionRecoveryStateContext) {}

    get version() {
        return this.changeVersion;
    }
    get isStopped() {
        return this.stopped;
    }
    get hasPending() {
        return this.pending.size > 0;
    }
    get(documentId: string): PendingReflectionRecord | undefined {
        return this.pending.get(documentId);
    }
    candidates(): readonly PendingReflectionRecord[] {
        return [...this.pending.values()];
    }
    attempt(documentId: string, revision: string): RecoveryAttempt | undefined {
        return this.attempts.get(recoveryKey(documentId, revision));
    }

    list(): readonly PendingReflection[] {
        return this.candidates().map((record) => ({
            ...record,
            running: !!this.attempt(record.documentId, record.revision),
        }));
    }

    onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Advance the observed change version and notify listeners without persisting a snapshot. */
    notifyChanged(): void {
        this.changeVersion++;
        for (const listener of this.listeners) {
            try {
                listener();
            } catch (error) {
                this.context.onListenerError(error);
            }
        }
    }

    stop(): void {
        this.stopped = true;
    }
    clearListeners(): void {
        this.listeners.clear();
    }

    /** Test pending-record ownership, rather than only matching its document and revision strings. */
    isCurrent(record: PendingReflectionRecord): boolean {
        return !this.stopped && this.pending.get(record.documentId) === record;
    }

    inspect(record: PendingReflectionRecord): ReflectionTargetScope {
        return targetScope(() => this.isCurrent(record));
    }

    /** Issue before waiting for the document lock. Ordinary work does not create a pending record. */
    issue(
        documentId: string,
        attempt?: RecoveryAttempt,
        source = attempt?.target.source ?? "received"
    ): ReflectionApplicationScope {
        const observation: FailureObservation = { generation: this.generation, pending: this.pending.get(documentId) };
        return {
            ...targetScope(
                () =>
                    observation.generation === this.generation &&
                    !this.stopped &&
                    (!attempt || this.pending.get(attempt.documentId) === attempt.target)
            ),
            source,
            observeRevision: (revision) => {
                observation.currentRevision = revision;
            },
            retainFailure: (failure, currentRevision = observation.currentRevision) =>
                this.retainFailure(failure, source, { ...observation, currentRevision }),
        };
    }

    /** Admit ordinary versioned file failures only while retention policy and this owner allow it. */
    acceptsFailure(failure: ContentReadFailure): boolean {
        return (
            !!failure.revision &&
            this.context.canRetainFailures() &&
            !this.context.isWaitingForReset() &&
            !this.stopped &&
            !isInternalMetadata(failure.documentId)
        );
    }

    /**
     * Merge a failure into its current pending record without letting late I/O replace newer work.
     * The captured generation, prior record, and observed revision constrain which updates are valid.
     * This changes memory and notifies listeners; the processor owns the durable write.
     */
    private retainFailure(
        failure: ContentReadFailure,
        source: PendingReflectionRecord["source"],
        observation: FailureObservation
    ) {
        const revision = failure.revision;
        const failedResources = failureResources(failure);
        if (!revision || !this.acceptsFailure(failure) || observation.generation !== this.generation) {
            return;
        }
        const previous = this.pending.get(failure.documentId);
        const sameTarget = previous?.revision === revision;
        // A late failure cannot replace a target introduced during I/O or snapshot restoration.
        if (previous !== observation.pending && !sameTarget) {
            return;
        }
        if (
            (observation.currentRevision && observation.currentRevision !== revision) ||
            (previous &&
                !sameTarget &&
                failedResources.includes("local-database") &&
                observation.currentRevision !== revision)
        ) {
            return;
        }
        const attempt = this.attempts.get(recoveryKey(failure.documentId, revision));
        if (attempt && previous !== attempt.target) {
            return;
        }
        if (!sameTarget && source === "received" && !this.context.isApplicationReady()) {
            return;
        }
        const resources = [...new Set([...(sameTarget ? (previous?.resources ?? []) : []), ...failedResources])].sort();
        const record: MutablePendingReflection =
            sameTarget && previous
                ? previous
                : {
                      documentId: failure.documentId,
                      revision,
                      source,
                      state: resources.length > 0 ? "waiting" : "review",
                      automaticAttempted: false,
                      resources,
                      reason: describeResources(resources),
                  };
        record.resources = resources;
        if (failedResources.length === 0) {
            this.moveRecordToReview(record, "unavailable");
        } else {
            record.reason = describeResources(resources);
            if (!record.automaticAttempted && !attempt) {
                record.state = "waiting";
            }
        }
        if (attempt) {
            attempt.failureReason = record.reason;
        }
        this.pending.set(record.documentId, record);
        this.notifyChanged();
        return record;
    }

    remove(record: PendingReflectionRecord): void {
        if (this.pending.get(record.documentId) !== record) {
            return;
        }
        this.pending.delete(record.documentId);
        this.notifyChanged();
    }

    /** Update a still-owned record's review reason and publish the change without saving it. */
    markForReview(record: PendingReflectionRecord | undefined, reason: string): void {
        const current = record && this.pending.get(record.documentId);
        if (current && current === record) {
            this.moveRecordToReview(current, reason);
        }
        this.notifyChanged();
    }

    /** Update a record's review state and reason without publishing a change. */
    private moveRecordToReview(record: MutablePendingReflection, reason: string): void {
        record.state = "review";
        record.reason = reason;
    }

    /** Require waiting state, an unused automatic allowance, and no remaining recovery dependencies. */
    private automaticEligible(record: PendingReflectionRecord): boolean {
        return record.state === "waiting" && !record.automaticAttempted && record.resources.length === 0;
    }

    /** Mark one dependency as recovered before checking whether a retry can be admitted. */
    resourceRecovered(resource: RecoveryResource): boolean {
        if (!this.context.canRetryResource(resource) || this.stopped) {
            return false;
        }
        let changed = false;
        for (const record of this.pending.values()) {
            if (record.state !== "waiting" || record.automaticAttempted || !record.resources.includes(resource)) {
                continue;
            }
            record.resources = record.resources.filter((required) => required !== resource);
            record.reason = describeResources(record.resources);
            changed = true;
        }
        if (changed) this.notifyChanged();
        return changed;
    }

    canAdmit(record: PendingReflectionRecord, kind: RecoveryAttempt["kind"]): boolean {
        return (
            this.pending.get(record.documentId) === record &&
            !this.attempt(record.documentId, record.revision) &&
            (kind !== "automatic" || this.automaticEligible(record))
        );
    }

    /** Reserve synchronously after Metadata inspection; the caller persists before enqueueing. */
    admit(record: PendingReflectionRecord, kind: RecoveryAttempt["kind"]): RecoveryAttempt | undefined {
        const current = this.pending.get(record.documentId);
        if (!current || !this.canAdmit(record, kind)) {
            return;
        }
        if (kind === "automatic") {
            current.automaticAttempted = true;
        }
        current.state = "review";
        const attempt: MutableRecoveryAttempt = {
            documentId: record.documentId,
            revision: record.revision,
            kind,
            target: current,
            started: false,
        };
        this.attempts.set(recoveryKey(record.documentId, record.revision), attempt);
        return attempt;
    }

    /** Require both the original target object and its exact reserved attempt to remain current. */
    isCurrentAttempt(attempt: RecoveryAttempt): boolean {
        return (
            this.pending.get(attempt.documentId) === attempt.target &&
            this.attempt(attempt.documentId, attempt.revision) === attempt
        );
    }

    /** Claim an existing reservation once; ordinary received work does not create one here. */
    startAttempt(documentId: string, revision: string): RecoveryAttempt | undefined {
        const attempt = this.attempts.get(recoveryKey(documentId, revision));
        if (!attempt || attempt.started) {
            return;
        }
        attempt.started = true;
        return attempt;
    }

    /** Release only this reservation and retain its outcome on the still-current record for review. */
    finishAttempt(attempt: RecoveryAttempt, reason = "reflection-failed"): void {
        const key = recoveryKey(attempt.documentId, attempt.revision);
        if (this.attempts.get(key) !== attempt) {
            return;
        }
        this.attempts.delete(key);
        const record = this.pending.get(attempt.documentId);
        if (record === attempt.target) {
            this.moveRecordToReview(record, attempt.failureReason ?? reason);
        }
        this.notifyChanged();
    }

    /** Copy pending records, resource arrays, and minimal attempt identities for the durable snapshot. */
    snapshot(): ReflectionSnapshot {
        return {
            ...(this.pending.size > 0
                ? {
                      pendingReflections: this.candidates().map((record) => ({
                          ...record,
                          resources: [...record.resources],
                      })),
                  }
                : {}),
            ...(this.attempts.size > 0
                ? {
                      recoveryAttempts: [...this.attempts.values()].map(({ documentId, revision, kind }) => ({
                          documentId,
                          revision,
                          kind,
                      })),
                  }
                : {}),
        };
    }

    /**
     * Validate and migrate stored pending records, preserving newer records and consumed allowances.
     * Return a queue filter so interrupted recovery attempts cannot replay as ordinary received work.
     */
    restore(snapshot: ReflectionSnapshot): (documentId: string, revision: string) => boolean {
        const interrupted = new Set(
            (snapshot.recoveryAttempts ?? []).map((attempt) => recoveryKey(attempt.documentId, attempt.revision))
        );
        for (const stored of snapshot.pendingReflections ?? []) {
            const storedSnapshotValue: unknown = stored;
            if (!isStoredPendingReflectionHeader(storedSnapshotValue)) {
                continue;
            }
            const storedResourcesField = storedSnapshotValue.resources;
            const validResources =
                Array.isArray(storedResourcesField) && storedResourcesField.every(isRecoveryResource);
            const storedResources = validResources
                ? storedResourcesField
                : storedResourcesField === undefined
                  ? legacyResources(stored.reason)
                  : [];
            const record: MutablePendingReflection = {
                ...stored,
                resources: [...new Set(storedResources)].sort(),
            };
            if (!validResources && storedResourcesField !== undefined) {
                record.reason = "unavailable";
            }
            if (interrupted.has(recoveryKey(record.documentId, record.revision))) {
                this.moveRecordToReview(record, "interrupted");
            } else if (record.automaticAttempted) {
                record.state = "review";
            } else if (record.reason === "unavailable" || record.resources.length === 0) {
                record.state = "review";
            } else {
                record.state = "waiting";
            }
            const existingPending = this.pending.get(record.documentId);
            if (!existingPending) {
                this.pending.set(record.documentId, record);
            } else if (existingPending.revision === record.revision && record.automaticAttempted) {
                existingPending.automaticAttempted = true;
                existingPending.state = "review";
            }
        }
        return (documentId, revision) => !interrupted.has(recoveryKey(documentId, revision));
    }

    /**
     * Invalidate issued scopes and detach records for a logical reset.
     * Rollback restores absent records and reservations, but deliberately keeps old scopes obsolete.
     */
    beginReset() {
        this.generation++;
        const previousPending = [...this.pending.entries()];
        const previousAttempts = [...this.attempts.entries()];
        const interrupted = new Set(this.attempts.keys());
        this.pending.clear();
        this.attempts.clear();
        return {
            keepQueued: (documentId: string, revision: string) => !interrupted.has(recoveryKey(documentId, revision)),
            rollback: () => {
                for (const [key, record] of previousPending) {
                    if (!this.pending.has(key)) {
                        this.pending.set(key, record);
                    }
                }
                for (const [key, attempt] of previousAttempts) {
                    if (!this.attempts.has(key)) {
                        this.attempts.set(key, attempt);
                    }
                }
            },
        };
    }
}
