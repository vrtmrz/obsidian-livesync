import type {
    DatabaseProbeAction,
    DatabaseProbeMode,
    DatabaseProbeSnapshot,
    DatabaseProbeStage,
    ReviewHarnessDatabaseProbe,
} from "./reviewHarnessDatabaseProbeTypes";
import type { ReviewHarnessScenarioStatus } from "./reviewHarnessTypes";

export interface DatabaseProbeEvent {
    readonly source: string;
    readonly name: string;
    readonly detail?: string;
    readonly registration?: "registered" | "unavailable";
    readonly stage?: DatabaseProbeStage;
}

export interface DatabaseProbeCheck {
    readonly observations: readonly string[];
    readonly connectionFailure: boolean;
}

export interface DatabaseProbeFixture {
    check(signal: AbortSignal): Promise<DatabaseProbeCheck>;
    closeNative(): void;
    reopen(signal: AbortSignal): Promise<DatabaseProbeCheck>;
    cleanup(): Promise<void>;
}

export interface DatabaseProbeRuntime {
    now(): Date;
    confirmStart(mode: DatabaseProbeMode): Promise<boolean>;
    createFixture(emit: (event: DatabaseProbeEvent) => void, signal: AbortSignal): Promise<DatabaseProbeFixture>;
    observeLifecycle(emit: (event: DatabaseProbeEvent) => void): () => void;
    inspectActiveDatabase(signal: AbortSignal, stage: DatabaseProbeStage): Promise<DatabaseProbeCheck>;
}

interface EventObservation {
    registration: "registered" | "unavailable" | "not-applicable";
    count: number;
    last: string;
    lastStage?: DatabaseProbeStage;
    detail?: string;
}

/** Owns a single guided run; the browser runtime owns only its disposable database. */
export class ReviewHarnessDatabaseProbeController implements ReviewHarnessDatabaseProbe {
    private mode: DatabaseProbeMode | null = null;
    private phase: DatabaseProbeSnapshot["phase"] = "idle";
    private status: ReviewHarnessScenarioStatus = "idle";
    private detail = "Not run";
    private readonly listeners = new Set<() => void>();
    private readonly events = new Map<string, EventObservation>();
    private readonly transcript: string[] = [];
    private readonly observations: string[] = [];
    private currentStage: DatabaseProbeStage = "baseline";
    private fixture: DatabaseProbeFixture | undefined;
    private unobserve: (() => void) | undefined;
    private aborter: AbortController | undefined;
    private pending: Promise<void> | undefined;
    private stopping: Promise<void> | undefined;
    private activeFailureObserved = false;
    private fixtureFailureObserved = false;
    private controlledFixtureFailureObserved = false;
    private controlledClosePerformed = false;
    private nativeClosed = false;
    private fixtureUnsupported = false;
    private disposed = false;
    private runSequence = 0;

    constructor(private readonly runtime: DatabaseProbeRuntime) {}

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }

    private readonly emit = (event: DatabaseProbeEvent): void => {
        const at = this.runtime.now().toISOString();
        const stage = event.stage ?? this.currentStage;
        const key = `${event.source}.${event.name}`;
        const previous = this.events.get(key);
        if (event.registration) {
            this.events.set(key, {
                registration: event.registration,
                count: previous?.count ?? 0,
                last: previous?.last ?? "none",
                ...(previous?.lastStage ? { lastStage: previous.lastStage } : {}),
                detail: event.detail,
            });
        } else {
            this.events.set(key, {
                registration: previous?.registration ?? "not-applicable",
                count: (previous?.count ?? 0) + 1,
                last: at,
                lastStage: stage,
                detail: previous?.detail,
            });
        }
        const kind = event.registration ? `registration=${event.registration}` : "event=received";
        this.transcript.push(`${at} stage=${stage} ${kind} ${key}${event.detail ? `: ${event.detail}` : ""}`);
        if (this.transcript.length > 100) {
            this.transcript.shift();
        }
        this.notify();
    };

    snapshot(): DatabaseProbeSnapshot {
        const waiting = this.phase === "observing";
        const availableActions: DatabaseProbeAction[] = waiting
            ? [
                  ...(this.fixture && this.mode === "controlled" && !this.nativeClosed
                      ? ["close-native" as const]
                      : []),
                  "check",
                  ...(this.fixture && this.mode === "controlled" && this.nativeClosed ? ["reopen" as const] : []),
                  "finish",
                  "cancel",
              ]
            : this.phase === "preparing" || this.phase === "checking"
              ? ["cancel"]
              : this.phase === "complete" && this.fixture
                ? ["finish"]
                : [];
        return {
            mode: this.mode,
            phase: this.phase,
            instruction: this.fixtureUnsupported
                ? "Native fixture capture is unavailable. Switch apps to observe browser and host events, choose Check connections, then finish and copy the report. Active database errors remain separate from fixture evidence."
                : this.mode === "background"
                  ? "Switch to another app, use it briefly, return to Obsidian, and choose Check connections. Finish with the evidence collected even if no failure occurs."
                  : "Close only the disposable database's native connection, check the retained handles, then optionally try an explicit reopen of the same database.",
            expected:
                "Baseline active-database errors are recorded separately. Only a fixture failure after this diagnostic closes its native connection counts as the controlled reproduction. Listener registration, zero-event counts, and received timestamps are useful evidence. Native close() does not emit a native close event. An explicit fixture reopen does not verify automatic LiveSync recovery.",
            availableActions,
            result: {
                status: this.status,
                detail: this.detail,
                observations: [
                    ...this.observations,
                    ...[...this.events].map(
                        ([key, value]) =>
                            `${key}: listener=${value.registration}; received=${value.count}; last=${value.last}${value.lastStage ? `; lastStage=${value.lastStage}` : ""}${value.detail ? `; ${value.detail}` : ""}`
                    ),
                    ...this.transcript,
                ],
            },
        };
    }

    async start(mode: DatabaseProbeMode): Promise<void> {
        if (this.disposed || this.pending || this.stopping || this.phase === "observing" || this.fixture) {
            return;
        }
        this.mode = mode;
        this.phase = "preparing";
        this.status = "running";
        this.detail = "Preparing a disposable database and recording event registrations.";
        this.events.clear();
        this.transcript.length = 0;
        this.observations.length = 0;
        this.activeFailureObserved = false;
        this.fixtureFailureObserved = false;
        this.controlledFixtureFailureObserved = false;
        this.controlledClosePerformed = false;
        this.currentStage = "baseline";
        this.nativeClosed = false;
        this.fixtureUnsupported = false;
        const aborter = new AbortController();
        this.aborter = aborter;
        const runSequence = ++this.runSequence;
        const emit = (event: DatabaseProbeEvent) => {
            if (this.runSequence === runSequence && this.phase !== "complete") {
                this.emit(event);
            }
        };
        this.notify();
        await this.track(async () => {
            if (!(await this.runtime.confirmStart(mode))) {
                this.status = "cancelled";
                this.detail = "The diagnostic was cancelled before creating a database.";
                this.phase = "complete";
                return;
            }
            if (aborter.signal.aborted) {
                return;
            }
            this.unobserve = this.runtime.observeLifecycle((event) =>
                emit({
                    ...event,
                    stage: event.stage ?? (event.registration ? "baseline" : "background-transition"),
                })
            );
            try {
                const emitFixtureEvent = (event: DatabaseProbeEvent) =>
                    emit({ ...event, stage: event.stage ?? this.currentStage });
                this.fixture = await this.runtime.createFixture(emitFixtureEvent, aborter.signal);
            } catch (error) {
                if (aborter.signal.aborted) {
                    throw error;
                }
                this.fixtureUnsupported = true;
                for (const name of ["close", "abort", "error", "versionchange"]) {
                    this.emit({ source: "fixture-native", name, registration: "unavailable" });
                }
                this.observations.push("fixture=unavailable; browser and host event observation remains active");
            }
            if (aborter.signal.aborted) {
                return;
            }
            await this.checkConnections(aborter.signal, "baseline");
            this.phase = "observing";
            this.status = "waiting-for-user";
            this.detail = this.waitingDetail();
        });
    }

    private async track(operation: () => Promise<void>): Promise<void> {
        const task = operation().catch(async () => {
            if (this.aborter?.signal.aborted) {
                return;
            }
            this.status = this.fixture ? "failed" : "unsupported";
            this.detail = this.fixture
                ? "A diagnostic operation could not complete. The recorded events remain available."
                : "The disposable native connection could not be prepared. Registration evidence remains available.";
            await this.cleanup();
            this.phase = "complete";
        });
        this.pending = task;
        try {
            await task;
        } finally {
            if (this.pending === task) {
                this.pending = undefined;
            }
            this.notify();
        }
    }

    private recordSample(source: "fixture" | "active", stage: DatabaseProbeStage, result: DatabaseProbeCheck): void {
        const sampledAt = this.runtime.now().toISOString();
        if (source === "fixture") {
            this.fixtureFailureObserved ||= result.connectionFailure;
            if (
                this.mode === "controlled" &&
                this.nativeClosed &&
                (stage === "after-native-close" || stage === "manual-check")
            ) {
                this.controlledFixtureFailureObserved ||= result.connectionFailure;
            }
        } else {
            this.activeFailureObserved ||= result.connectionFailure;
        }
        this.observations.push(
            ...result.observations.map(
                (observation) => `${source} sample; stage=${stage}; sampledAt=${sampledAt}; ${observation}`
            )
        );
        if (this.observations.length > 60) {
            this.observations.splice(0, this.observations.length - 60);
        }
    }

    private async checkConnections(signal: AbortSignal, stage: DatabaseProbeStage): Promise<void> {
        this.currentStage = stage;
        if (this.fixture) {
            const result = await this.fixture.check(signal);
            this.recordSample("fixture", stage, result);
        }
        const active = await this.runtime.inspectActiveDatabase(signal, stage);
        this.recordSample("active", stage, active);
    }

    private waitingDetail(): string {
        if (this.fixtureUnsupported) {
            return "Native fixture capture is unavailable. Browser and host events remain observable; active database samples do not replace fixture evidence.";
        }
        if (this.mode === "controlled") {
            if (this.controlledFixtureFailureObserved) {
                return "The disposable fixture failed after the controlled native close. Keep collecting events, try an explicit fixture reopen, or finish.";
            }
            if (this.activeFailureObserved) {
                return "An active database check failed. This does not establish the controlled fixture result; keep collecting evidence or finish.";
            }
            if (this.fixtureFailureObserved) {
                return "A fixture check failed before the controlled native close. This does not establish the controlled reproduction; keep collecting evidence or finish.";
            }
            return "No controlled fixture connection failure has been observed. Follow the guide; a connection failure is not required.";
        }
        if (this.activeFailureObserved || this.fixtureFailureObserved) {
            return "A connection failure was observed during background monitoring. Keep collecting events or finish.";
        }
        return "Event observation is active. Follow the guide; a connection failure is not required.";
    }

    private completionDetail(cancelled: boolean): string {
        if (cancelled) {
            return "Observation was cancelled; the collected event evidence is retained.";
        }
        if (this.fixtureUnsupported) {
            return "Native fixture capture is unavailable. Active database samples and event evidence are retained, but they do not establish the controlled fixture result.";
        }
        if (this.mode === "controlled" && this.controlledFixtureFailureObserved) {
            return "A connection failure was observed in the disposable fixture after its controlled native close. Explicit reopen results are diagnostic, not automatic recovery.";
        }
        if (this.mode === "controlled") {
            if (!this.controlledClosePerformed) {
                return "No controlled native close was performed. Active database samples and event evidence are retained separately.";
            }
            return "No fixture connection failure followed the controlled native close. Active database samples and event evidence are retained separately.";
        }
        if (this.activeFailureObserved || this.fixtureFailureObserved) {
            return "A connection failure was observed during background monitoring. The event and database samples are retained; this does not verify automatic LiveSync recovery.";
        }
        return "No connection failure was observed. Event registrations, zero counts, and received events are retained.";
    }

    async perform(action: DatabaseProbeAction): Promise<void> {
        if (action === "cancel") {
            if (this.phase !== "idle" && this.phase !== "complete") {
                await this.stop(true);
            }
            return;
        }
        if (!this.snapshot().availableActions.includes(action) || !this.aborter) {
            return;
        }
        if (action === "finish") {
            await this.stop(false);
            return;
        }
        const signal = this.aborter.signal;
        this.phase = "checking";
        this.notify();
        await this.track(async () => {
            if (action === "close-native") {
                this.currentStage = "after-native-close";
                this.fixture!.closeNative();
                this.nativeClosed = true;
                this.controlledClosePerformed = true;
                await this.checkConnections(signal, "after-native-close");
            } else if (action === "reopen") {
                this.currentStage = "after-explicit-reopen";
                const result = await this.fixture!.reopen(signal);
                this.recordSample("fixture", "after-explicit-reopen", result);
                this.nativeClosed = false;
            } else {
                await this.checkConnections(signal, "manual-check");
            }
            if (signal.aborted) {
                return;
            }
            this.phase = "observing";
            this.status = "waiting-for-user";
            this.detail = this.waitingDetail();
        });
    }

    private async cleanup(): Promise<void> {
        try {
            await this.fixture?.cleanup();
            this.fixture = undefined;
            this.observations.push("cleanup=completed");
        } catch {
            this.observations.push("cleanup=failed; only this run's disposable database may remain");
            this.status = "failed";
            this.detail =
                "Fixture cleanup did not complete. Finish observation retries cleanup of this run's fixture only.";
        } finally {
            this.unobserve?.();
            this.unobserve = undefined;
            this.notify();
        }
    }

    private async stop(cancelled: boolean): Promise<void> {
        if (this.stopping) {
            return await this.stopping;
        }
        this.aborter?.abort();
        const task = (async () => {
            await this.pending;
            this.phase = "finishing";
            this.notify();
            this.status = cancelled
                ? "cancelled"
                : this.fixtureUnsupported
                  ? "unsupported"
                  : this.mode === "controlled"
                    ? this.controlledFixtureFailureObserved
                        ? "passed"
                        : "not-observed"
                    : this.activeFailureObserved || this.fixtureFailureObserved
                      ? "passed"
                      : "not-observed";
            this.detail = this.completionDetail(cancelled);
            await this.cleanup();
            this.phase = "complete";
            this.notify();
        })();
        this.stopping = task;
        try {
            await task;
        } finally {
            this.stopping = undefined;
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        if (this.fixture || (this.phase !== "idle" && this.phase !== "complete")) {
            await this.stop(true);
        }
        this.listeners.clear();
    }
}
