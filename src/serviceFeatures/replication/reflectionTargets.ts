import { isTransientContentReadFailure, type ContentReadFailure } from "@vrtmrz/livesync-commonlib/replication";
import { isInternalMetadata } from "@vrtmrz/livesync-commonlib/compat/common/typeUtils";

export interface PendingReflection {
    documentId: string;
    revision: string;
    source: "scan" | "received";
    state: "waiting" | "review";
    automaticAttempted: boolean;
    reason: string;
    running: boolean;
}

export interface ReflectionRecoveryView {
    list(): readonly PendingReflection[];
    retry(documentIds: readonly string[]): Promise<void>;
    reconcile(): Promise<void>;
    onChanged(listener: () => void): () => void;
}

type MutablePendingReflection = Omit<PendingReflection, "running">;
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

interface ReflectionTargetsContext {
    canDeferFailure(reason: ContentReadFailure["reason"]): boolean;
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

function recoveryKey(documentId: string, revision: string): string {
    return JSON.stringify([documentId, revision]);
}

function isPendingReflectionRecord(value: unknown): value is PendingReflectionRecord {
    if (!value || typeof value !== "object") {
        return false;
    }
    return (
        "documentId" in value &&
        typeof value.documentId === "string" &&
        "revision" in value &&
        typeof value.revision === "string" &&
        "source" in value &&
        (value.source === "scan" || value.source === "received") &&
        "state" in value &&
        (value.state === "waiting" || value.state === "review") &&
        "automaticAttempted" in value &&
        typeof value.automaticAttempted === "boolean" &&
        "reason" in value &&
        typeof value.reason === "string"
    );
}

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

/** Owns target identity and retry allowances; the processor owns queues and durable writes. */
export class ReflectionTargets {
    private readonly pending = new Map<string, MutablePendingReflection>();
    private readonly attempts = new Map<string, MutableRecoveryAttempt>();
    private readonly listeners = new Set<() => void>();
    private generation = 0;
    private changeVersion = 0;
    private stopped = false;

    constructor(private readonly context: ReflectionTargetsContext) {}

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
        return this.candidates().map((target) => ({
            ...target,
            running: !!this.attempt(target.documentId, target.revision),
        }));
    }

    onChanged(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

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

    isCurrent(target: PendingReflectionRecord): boolean {
        return !this.stopped && this.pending.get(target.documentId) === target;
    }

    inspect(target: PendingReflectionRecord): ReflectionTargetScope {
        return targetScope(() => this.isCurrent(target));
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

    acceptsFailure(failure: ContentReadFailure): boolean {
        return (
            !!failure.revision &&
            !this.context.isWaitingForReset() &&
            !this.stopped &&
            !(failure.reason === "local-database" && isInternalMetadata(failure.documentId))
        );
    }

    private retainFailure(
        failure: ContentReadFailure,
        source: PendingReflectionRecord["source"],
        observation: FailureObservation
    ) {
        const revision = failure.revision;
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
            (previous && !sameTarget && failure.reason === "local-database" && observation.currentRevision !== revision)
        ) {
            return;
        }
        const attempt = this.attempts.get(recoveryKey(failure.documentId, revision));
        if (attempt && previous !== attempt.target) {
            return;
        }
        if (
            !sameTarget &&
            (!this.context.canDeferFailure(failure.reason) ||
                !isTransientContentReadFailure(failure) ||
                (source === "received" && !this.context.isApplicationReady()))
        ) {
            return;
        }
        const target =
            sameTarget && previous
                ? previous
                : {
                      documentId: failure.documentId,
                      revision,
                      source,
                      state: "waiting" as const,
                      automaticAttempted: false,
                      reason: failure.reason,
                  };
        target.reason = failure.reason;
        if (!isTransientContentReadFailure(failure)) {
            target.state = "review";
        }
        if (attempt) {
            attempt.failureReason = failure.reason;
        }
        this.pending.set(target.documentId, target);
        this.notifyChanged();
        return target;
    }

    remove(target: PendingReflectionRecord): void {
        if (this.pending.get(target.documentId) !== target) {
            return;
        }
        this.pending.delete(target.documentId);
        this.notifyChanged();
    }

    markForReview(target: PendingReflectionRecord | undefined, reason: string): void {
        const current = target && this.pending.get(target.documentId);
        if (current && current === target) {
            current.state = "review";
            current.reason = reason;
        }
        this.notifyChanged();
    }

    private automaticEligible(target: PendingReflectionRecord, resource: RecoveryResource): boolean {
        const reason = target.reason;
        if (reason !== "local-database" && reason !== "offline" && reason !== "transport") {
            return false;
        }
        return (
            target.state === "waiting" &&
            !target.automaticAttempted &&
            (reason === "local-database") === (resource === "local-database") &&
            this.context.canDeferFailure(reason)
        );
    }

    canAdmit(target: PendingReflectionRecord, kind: RecoveryAttempt["kind"], resource: RecoveryResource): boolean {
        return (
            this.pending.get(target.documentId) === target &&
            !this.attempt(target.documentId, target.revision) &&
            (kind !== "automatic" || this.automaticEligible(target, resource))
        );
    }

    /** Reserve synchronously after Metadata inspection; the caller persists before enqueueing. */
    admit(
        target: PendingReflectionRecord,
        kind: RecoveryAttempt["kind"],
        resource: RecoveryResource
    ): RecoveryAttempt | undefined {
        const current = this.pending.get(target.documentId);
        if (!current || !this.canAdmit(target, kind, resource)) {
            return;
        }
        if (kind === "automatic") {
            current.automaticAttempted = true;
        }
        current.state = "review";
        const attempt: MutableRecoveryAttempt = {
            documentId: target.documentId,
            revision: target.revision,
            kind,
            target: current,
            started: false,
        };
        this.attempts.set(recoveryKey(target.documentId, target.revision), attempt);
        return attempt;
    }

    isCurrentAttempt(attempt: RecoveryAttempt): boolean {
        return (
            this.pending.get(attempt.documentId) === attempt.target &&
            this.attempt(attempt.documentId, attempt.revision) === attempt
        );
    }

    startAttempt(documentId: string, revision: string): RecoveryAttempt | undefined {
        const attempt = this.attempts.get(recoveryKey(documentId, revision));
        if (!attempt || attempt.started) {
            return;
        }
        attempt.started = true;
        return attempt;
    }

    finishAttempt(attempt: RecoveryAttempt, reason = "reflection-failed"): void {
        const key = recoveryKey(attempt.documentId, attempt.revision);
        if (this.attempts.get(key) !== attempt) {
            return;
        }
        this.attempts.delete(key);
        const target = this.pending.get(attempt.documentId);
        if (target === attempt.target) {
            target.state = "review";
            target.reason = attempt.failureReason ?? reason;
        }
        this.notifyChanged();
    }

    snapshot(): ReflectionSnapshot {
        return {
            ...(this.pending.size > 0
                ? { pendingReflections: this.candidates().map((target) => ({ ...target })) }
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

    /** Return a queue filter so consumed recovery work cannot be replayed as ordinary work. */
    restore(snapshot: ReflectionSnapshot): (documentId: string, revision: string) => boolean {
        const interrupted = new Set(
            (snapshot.recoveryAttempts ?? []).map((attempt) => recoveryKey(attempt.documentId, attempt.revision))
        );
        for (const stored of snapshot.pendingReflections ?? []) {
            if (!isPendingReflectionRecord(stored)) {
                continue;
            }
            const target = { ...stored };
            if (interrupted.has(recoveryKey(target.documentId, target.revision))) {
                target.state = "review";
                target.reason = "interrupted";
            } else if (target.automaticAttempted) {
                target.state = "review";
            }
            const existing = this.pending.get(target.documentId);
            if (!existing) {
                this.pending.set(target.documentId, target);
            } else if (existing.revision === target.revision && target.automaticAttempted) {
                existing.automaticAttempted = true;
                existing.state = "review";
            }
        }
        return (documentId, revision) => !interrupted.has(recoveryKey(documentId, revision));
    }

    /** Reset invalidates issued scopes even when persisting the reset later fails. */
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
                for (const [key, target] of previousPending) {
                    if (!this.pending.has(key)) {
                        this.pending.set(key, target);
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
