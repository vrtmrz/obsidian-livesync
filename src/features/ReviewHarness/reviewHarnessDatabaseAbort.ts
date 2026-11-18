import type { ReviewHarnessScenarioResult } from "./reviewHarnessTypes";
import type { DatabaseProbeEvent } from "./reviewHarnessDatabaseProbe";
import {
    createDatabaseProbeFixture,
    databaseProbeErrorName,
    type DatabaseAbortProbeFixture,
    type ProbePouchConstructor,
} from "./reviewHarnessDatabaseProbeRuntime";

interface DatabaseAbortDiagnosticOptions {
    readonly factory: IDBFactory;
    readonly PouchDB: ProbePouchConstructor;
    readonly createToken: () => string;
    readonly confirmStart: () => Promise<boolean>;
    readonly now?: () => Date;
    readonly logEvent?: (event: DatabaseProbeEvent) => void;
}

interface AbortObservationContext {
    readonly adapter: "idb" | "indexeddb";
    readonly observations: string[];
    readonly events: Map<string, { registered: boolean; received: number; last: string }>;
    readonly options: Pick<DatabaseAbortDiagnosticOptions, "now" | "logEvent">;
}

/** Keep bounded event detail separately from counts, including registered listeners with no events. */
function recordAbortEvent(context: AbortObservationContext, event: DatabaseProbeEvent): void {
    const { adapter, events, observations, options } = context;
    const name = `${event.source}.${event.name}`;
    const observation = events.get(name) ?? { registered: false, received: 0, last: "none" };
    const at = (options.now?.() ?? new Date()).toISOString();
    if (event.registration) {
        observation.registered = event.registration === "registered";
    } else {
        observation.received++;
        observation.last = at;
    }
    events.set(name, observation);
    if (observations.length < 160) {
        observations.push(
            `${adapter} ${at} ${name}: ${event.registration ?? "received"}${event.detail ? `; ${event.detail}` : ""}`
        );
    }
    options.logEvent?.({ ...event, source: `${adapter}.${event.source}` });
}

/** Record the read state after a real abort; an observation deadline never completes its drain. */
async function observeAbortedFixture(
    fixture: DatabaseAbortProbeFixture,
    signal: AbortSignal,
    { adapter, observations }: Pick<AbortObservationContext, "adapter" | "observations">
): Promise<boolean> {
    const before = await fixture.verifyContents(signal);
    observations.push(
        `${adapter}.baseline.contentMatches=${before.contentMatches}; revisionMatches=${before.revisionMatches}`
    );
    const aborted = await fixture.abortRead(signal);
    observations.push(
        `${adapter}.abort.injected=${aborted.injected}; operation=${aborted.outcome}; drain=${aborted.drained}; error=${aborted.errorName ?? "none"}`
    );
    observations.push(`${adapter}.reopen=not-attempted; this diagnostic observes the aborted read`);
    return before.contentMatches && before.revisionMatches && aborted.injected;
}

/** Observe stock adapters on disposable fixtures; restarting remains an explicit user action. */
export async function runReviewHarnessDatabaseAbort(
    options: DatabaseAbortDiagnosticOptions
): Promise<ReviewHarnessScenarioResult> {
    if (!(await options.confirmStart())) {
        return { status: "cancelled", detail: "Transaction-abort diagnostic was cancelled.", observations: [] };
    }
    const observations: string[] = [];
    let passed = true;
    for (const adapter of ["idb", "indexeddb"] as const) {
        const context: AbortObservationContext = { adapter, observations, options, events: new Map() };
        const aborter = new AbortController();
        let fixture: DatabaseAbortProbeFixture | undefined;
        try {
            fixture = await createDatabaseProbeFixture({
                factory: options.factory,
                PouchDB: options.PouchDB,
                adapter,
                token: options.createToken(),
                emit: (event) => recordAbortEvent(context, event),
                signal: aborter.signal,
            });
            if (!(await observeAbortedFixture(fixture, aborter.signal, context))) {
                passed = false;
            }
        } catch (error) {
            passed = false;
            observations.push(`${adapter}.diagnostic=error; name=${databaseProbeErrorName(error)}`);
        } finally {
            try {
                if (fixture) {
                    await fixture.cleanup();
                    observations.push(`${adapter}.cleanup=completed`);
                } else {
                    observations.push(`${adapter}.cleanup=not-applicable; no prepared fixture was returned`);
                }
            } catch (error) {
                passed = false;
                observations.push(`${adapter}.cleanup=error; name=${databaseProbeErrorName(error)}`);
            }
            for (const [name, event] of context.events) {
                observations.push(
                    `${adapter}.${name}: listener=${event.registered ? "registered" : "not-applicable"}; received=${event.received}; last=${event.last}`
                );
            }
        }
    }
    observations.push(
        "This observes disposable adapter fixtures. Copy this report, then press Restart Obsidian. No automatic recovery or restart is performed."
    );
    return {
        status: passed ? "observed" : "failed",
        detail: passed
            ? "Abort injection and read state were observed on both stock adapters. Pending reads are observations, not completed drain. Copy the report, then press Restart Obsidian."
            : "The abort observation could not be completed on an adapter. Copy the available observations, then press Restart Obsidian.",
        observations,
    };
}
