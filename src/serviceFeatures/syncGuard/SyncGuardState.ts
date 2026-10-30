/** The guard observes catch-up work without changing replication or Vault writes. */
export type SyncGuardPhase = "idle" | "observing" | "transferring" | "applying" | "interrupted";

export interface SyncGuardPresentation {
    phase: SyncGuardPhase;
    receivedFiles: number;
}

/**
 * One resume-triggered CouchDB catch-up attempt. Small transfers never lock the workspace.
 * Network completion alone does not unlock it: received documents still need reflecting to the Vault.
 */
export class SyncGuardState {
    private phase: SyncGuardPhase = "idle";
    private receivedIds = new Set<string>();
    private minimumFiles = 20;
    private catchUpActive = false;
    private observedCompletion = false;
    private hadReflectionFailure = false;
    private bypassed = false;
    private quiescentSince: number | undefined;

    constructor(
        private readonly onChange: (presentation: SyncGuardPresentation) => void,
        private readonly quietPeriodMs = 2_000
    ) {}

    get presentation(): SyncGuardPresentation {
        return { phase: this.phase, receivedFiles: this.receivedIds.size };
    }

    get wasBypassed(): boolean {
        return this.bypassed;
    }

    get isCatchUpActive(): boolean {
        return this.catchUpActive;
    }

    /** Begins a fresh, initially non-blocking observation window on app resume. */
    resume(enabled: boolean, minimumFiles: number): void {
        this.minimumFiles = Number.isFinite(minimumFiles) ? Math.max(1, Math.floor(minimumFiles)) : 20;
        this.receivedIds.clear();
        this.catchUpActive = false;
        this.observedCompletion = false;
        this.hadReflectionFailure = false;
        this.bypassed = false;
        this.quiescentSince = undefined;
        this.setPhase(enabled ? "observing" : "idle");
    }

    /** A changed setting takes effect during observation, without cancelling an active protection. */
    updateThreshold(minimumFiles: number): void {
        this.minimumFiles = Number.isFinite(minimumFiles) ? Math.max(1, Math.floor(minimumFiles)) : 20;
        if (this.phase === "observing" && this.catchUpActive && this.receivedIds.size >= this.minimumFiles) {
            this.setPhase("transferring");
        }
    }

    /** The CouchDB catch-up phase ends before continuous replication and Vault reflection finish. */
    catchUpActivityChanged(active: boolean, pendingCount: number, now: number): void {
        if (this.catchUpActive === active) return;
        // A manual bypass lasts only for this catch-up generation. Even while the
        // overlay is closed, observe its terminal transition so that a later
        // reconnect can protect the workspace again.
        if (this.bypassed) {
            this.catchUpActive = active;
            if (!active) this.bypassed = false;
            return;
        }
        if (this.phase === "idle") return;
        if (active) {
            // A retry or a second pull can begin while the Vault is still applying an earlier batch.
            // Do not let the previous successful completion unlock an active newer transfer.
            this.catchUpActive = true;
            this.observedCompletion = false;
            this.quiescentSince = undefined;
            if (this.isBlocking()) this.setPhase("transferring");
            return;
        }
        this.catchUpActive = false;
        if (!this.isBlocking()) {
            this.setPhase("idle");
        } else if (!this.observedCompletion || this.hadReflectionFailure) {
            this.setPhase("interrupted");
        } else {
            this.setPhase("applying");
            this.tick(pendingCount, now);
        }
    }

    /** Only the catch-up → continuous transition proves that the initial pull succeeded. */
    catchUpSucceeded(): void {
        if (this.phase === "idle" || this.bypassed || !this.catchUpActive) return;
        this.observedCompletion = true;
    }

    /** A network-complete batch is not a safe unlock when reflecting a received note failed. */
    reflectionFailed(): void {
        if (this.phase === "idle" || this.bypassed) return;
        this.hadReflectionFailure = true;
        if (this.phase === "applying") this.setPhase("interrupted");
    }

    /** Count distinct incoming note Metadata, not Chunks or repeated revisions of a note. */
    receivedDocuments(ids: readonly string[]): void {
        if (!this.catchUpActive || this.bypassed || this.phase === "idle") return;
        const wasBlocking = this.isBlocking();
        const previousCount = this.receivedIds.size;
        for (const id of ids) {
            if (id) this.receivedIds.add(id);
        }
        if (!wasBlocking && this.receivedIds.size >= this.minimumFiles) this.setPhase("transferring");
        else if (wasBlocking && this.receivedIds.size !== previousCount) this.onChange(this.presentation);
    }

    /** Unlock only after successful transfer and a stable empty local application queue. */
    tick(pendingCount: number, now: number): void {
        if (this.phase !== "applying") return;
        if (pendingCount > 0) {
            this.quiescentSince = undefined;
            return;
        }
        this.quiescentSince ??= now;
        if (now - this.quiescentSince >= this.quietPeriodMs) this.setPhase("idle");
    }

    /** An offline or suspended attempt can be bypassed rather than trapping the user. */
    interrupted(): void {
        if (this.isBlocking()) this.setPhase("interrupted");
        else this.setPhase("idle");
    }

    bypass(): void {
        this.bypassed = true;
        this.setPhase("idle");
    }

    disable(): void {
        this.bypassed = true;
        this.setPhase("idle");
    }

    private isBlocking(): boolean {
        return this.phase === "transferring" || this.phase === "applying" || this.phase === "interrupted";
    }

    private setPhase(next: SyncGuardPhase): void {
        if (this.phase === next) return;
        this.phase = next;
        this.onChange(this.presentation);
    }
}
