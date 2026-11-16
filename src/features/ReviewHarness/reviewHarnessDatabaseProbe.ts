import type {
    DatabaseProbeAction,
    DatabaseProbeMode,
    DatabaseProbeSnapshot,
    ReviewHarnessDatabaseProbe,
} from "./reviewHarnessDatabaseProbeTypes";
import type { ReviewHarnessScenarioStatus } from "./reviewHarnessTypes";

export interface DatabaseProbeEvent {
    readonly source: string;
    readonly name: string;
    readonly detail?: string;
    readonly registration?: "registered" | "unavailable";
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
    inspectActiveDatabase(signal: AbortSignal): Promise<DatabaseProbeCheck>;
}

interface EventObservation {
    registration: "registered" | "unavailable" | "not-applicable";
    count: number;
    last: string;
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
    private fixture: DatabaseProbeFixture | undefined;
    private unobserve: (() => void) | undefined;
    private aborter: AbortController | undefined;
    private pending: Promise<void> | undefined;
    private stopping: Promise<void> | undefined;
    private failureObserved = false;
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
        const key = `${event.source}.${event.name}`;
        const previous = this.events.get(key);
        if (event.registration) {
            this.events.set(key, {
                registration: event.registration,
                count: previous?.count ?? 0,
                last: previous?.last ?? "none",
                detail: event.detail,
            });
        } else {
            this.events.set(key, {
                registration: previous?.registration ?? "not-applicable",
                count: (previous?.count ?? 0) + 1,
                last: at,
                detail: previous?.detail,
            });
        }
        this.transcript.push(`${at} ${key}${event.detail ? `: ${event.detail}` : ""}`);
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
                ? "Native capture is unavailable. Switch apps to observe browser and host events, choose Check connections, then finish and copy the report."
                : this.mode === "background"
                  ? "Switch to another app, use it briefly, return to Obsidian, and choose Check connections. Finish with the evidence collected even if no failure occurs."
                  : "Close only the disposable database's native connection, check the retained handles, then optionally try an explicit reopen of the same database.",
            expected:
                "Listener registration, zero-event counts, and received timestamps are useful evidence. Native close() does not emit a native close event. This tool does not verify automatic LiveSync recovery.",
            availableActions,
            result: {
                status: this.status,
                detail: this.detail,
                observations: [
                    ...this.observations,
                    ...[...this.events].map(
                        ([key, value]) =>
                            `${key}: listener=${value.registration}; received=${value.count}; last=${value.last}${value.detail ? `; ${value.detail}` : ""}`
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
        this.failureObserved = false;
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
            this.unobserve = this.runtime.observeLifecycle(emit);
            try {
                this.fixture = await this.runtime.createFixture(emit, aborter.signal);
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
            await this.checkConnections(aborter.signal);
            this.phase = "observing";
            this.status = "waiting-for-user";
            this.detail = this.fixtureUnsupported
                ? "Native fixture capture is unavailable. Browser and host events are still being observed; switch apps, check, and copy the evidence."
                : "Event observation is active. Follow the guide; a connection failure is not required.";
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

    private async checkConnections(signal: AbortSignal): Promise<void> {
        if (this.fixture) {
            const result = await this.fixture.check(signal);
            this.failureObserved ||= result.connectionFailure;
            this.observations.push(...result.observations);
        }
        const active = await this.runtime.inspectActiveDatabase(signal);
        this.failureObserved ||= active.connectionFailure;
        this.observations.push(...active.observations);
        if (this.observations.length > 60) {
            this.observations.splice(0, this.observations.length - 60);
        }
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
                this.fixture!.closeNative();
                this.nativeClosed = true;
                await this.checkConnections(signal);
            } else if (action === "reopen") {
                const result = await this.fixture!.reopen(signal);
                this.failureObserved ||= result.connectionFailure;
                this.observations.push(...result.observations);
                this.nativeClosed = false;
            } else {
                await this.checkConnections(signal);
            }
            if (signal.aborted) {
                return;
            }
            this.phase = "observing";
            this.status = "waiting-for-user";
            this.detail = this.failureObserved
                ? "A connection failure was observed. Keep collecting events, try an explicit reopen, or finish."
                : "No connection failure has been observed. Event registration and receipt remain recorded.";
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
                : this.failureObserved
                  ? "passed"
                  : this.fixtureUnsupported
                    ? "unsupported"
                    : "not-observed";
            this.detail = cancelled
                ? "Observation was cancelled; the collected event evidence is retained."
                : this.failureObserved
                  ? "A connection failure was observed. Explicit reopen results are diagnostic, not automatic recovery."
                  : "No connection failure was observed. Event registrations, zero counts, and received events are retained.";
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
