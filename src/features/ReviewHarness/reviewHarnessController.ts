import type { ObsidianLiveSyncSettings, SettingsMigrationState } from "@vrtmrz/livesync-commonlib/settings";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import {
    REVIEW_HARNESS_SCENARIOS,
    REVIEW_HARNESS_STATE_KEY,
    formatReviewHarnessReport,
    inspectCompatibilityReview,
    inspectSettingsLifecycle,
    parsePendingReviewRun,
    type ReviewHarnessReportInput,
    type ReviewHarnessScenarioId,
    type ReviewHarnessScenarioResult,
} from "./reviewHarnessContract";

export interface ReviewHarnessRuntime {
    now(): Date;
    getSettings(): Partial<ObsidianLiveSyncSettings>;
    getNewVaultSettings(): Partial<ObsidianLiveSyncSettings>;
    getSettingsMigrationState(): SettingsMigrationState | undefined;
    isCompatibilityReviewInitialised(): boolean;
    getCompatibilityPause(): CompatibilityPause | undefined;
    openCompatibilityReview(): Promise<void>;
    getP2PComposition(): {
        readonly first: unknown;
        readonly second: unknown;
        readonly expectedServices: unknown;
    };
    runVaultRoundTrip(): Promise<ReviewHarnessScenarioResult>;
    readContinuation(): string | null;
    writeContinuation(value: string): void;
    deleteContinuation(): void;
    restart(): void;
    reportError(error: unknown): void;
    copyText(value: string): Promise<void>;
    getEnvironment(): ReviewHarnessReportInput["environment"];
}

export interface ReviewHarnessTranscriptEntry {
    readonly at: string;
    readonly event: string;
    readonly detail?: string;
}

export interface ReviewHarnessSnapshot {
    readonly results: Record<ReviewHarnessScenarioId, ReviewHarnessScenarioResult>;
    readonly running: boolean;
    readonly current: ReviewHarnessScenarioId | null;
    readonly resumedRequestId: string | null;
    readonly continuationError: string | null;
    readonly transcript: readonly ReviewHarnessTranscriptEntry[];
}

const idleResult = (): ReviewHarnessScenarioResult => ({
    status: "idle",
    detail: "Not run",
    observations: [],
});

function initialResults(): Record<ReviewHarnessScenarioId, ReviewHarnessScenarioResult> {
    return Object.fromEntries(REVIEW_HARNESS_SCENARIOS.map(({ id }) => [id, idleResult()])) as Record<
        ReviewHarnessScenarioId,
        ReviewHarnessScenarioResult
    >;
}

function inspectP2PComposition(input: ReturnType<ReviewHarnessRuntime["getP2PComposition"]>): ReviewHarnessScenarioResult {
    if (input.first !== input.second) {
        return {
            status: "failed",
            detail: "Two consecutive reads resolved different P2P replicators without a lifecycle transition.",
            observations: [],
        };
    }
    if (typeof input.first !== "object" || input.first === null) {
        return {
            status: "failed",
            detail: "The P2P composition did not expose a current replicator.",
            observations: [],
        };
    }
    const env = "env" in input.first ? input.first.env : undefined;
    const services = typeof env === "object" && env !== null && "services" in env ? env.services : undefined;
    if (services !== input.expectedServices) {
        return {
            status: "failed",
            detail: "The current P2P replicator is not bound to the active Obsidian services.",
            observations: [],
        };
    }
    return {
        status: "passed",
        detail: "The live P2P result resolves the current replicator and active Obsidian services.",
        observations: [],
    };
}

export class ReviewHarnessController {
    private readonly results = initialResults();
    private readonly transcript: ReviewHarnessTranscriptEntry[] = [];
    private readonly listeners = new Set<() => void>();
    private running = false;
    private current: ReviewHarnessScenarioId | null = null;
    private resumedRequestId: string | null = null;
    private continuationError: string | null = null;

    constructor(private readonly runtime: ReviewHarnessRuntime) {}

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }

    private record(event: string, detail?: string): void {
        this.transcript.push({
            at: this.runtime.now().toISOString(),
            event,
            ...(detail ? { detail } : {}),
        });
        while (this.transcript.length > 100) this.transcript.shift();
    }

    snapshot(): ReviewHarnessSnapshot {
        return {
            results: Object.fromEntries(
                REVIEW_HARNESS_SCENARIOS.map(({ id }) => [id, { ...this.results[id] }])
            ) as Record<ReviewHarnessScenarioId, ReviewHarnessScenarioResult>,
            running: this.running,
            current: this.current,
            resumedRequestId: this.resumedRequestId,
            continuationError: this.continuationError,
            transcript: [...this.transcript],
        };
    }

    consumeContinuation(): void {
        const serialised = this.runtime.readContinuation();
        if (!serialised) return;
        this.runtime.deleteContinuation();
        const parsed = parsePendingReviewRun(serialised);
        if (!parsed.pendingRun) {
            this.continuationError = parsed.error ?? "The Review Harness continuation was invalid.";
            this.results["compatibility-review"] = {
                status: "failed",
                detail: "The stored continuation was invalid and was removed.",
                observations: [],
            };
            this.record("continuation-rejected");
            this.notify();
            return;
        }
        this.resumedRequestId = parsed.pendingRun.requestId;
        this.results["compatibility-review"] = {
            status: "waiting-for-user",
            detail: "Obsidian returned after the requested restart. Open the compatibility review to continue.",
            observations: [`requestedAt=${parsed.pendingRun.requestedAt}`],
        };
        this.record("continuation-consumed", parsed.pendingRun.requestId);
        this.notify();
    }

    async runAutomaticScenarios(): Promise<void> {
        for (const id of ["settings-lifecycle", "p2p-composition"] as const) {
            await this.runScenario(id);
        }
    }

    async runAllScenarios(): Promise<void> {
        for (const { id } of REVIEW_HARNESS_SCENARIOS) await this.runScenario(id);
    }

    private inspectCompatibilityReview(): ReviewHarnessScenarioResult {
        return inspectCompatibilityReview({
            migration: this.runtime.getSettingsMigrationState(),
            reviewInitialised: this.runtime.isCompatibilityReviewInitialised(),
            pendingPause: this.runtime.getCompatibilityPause(),
        });
    }

    async runScenario(id: ReviewHarnessScenarioId): Promise<void> {
        if (this.running) return;
        this.running = true;
        this.current = id;
        this.results[id] = { status: "running", detail: "Running", observations: [] };
        this.record("scenario-started", id);
        this.notify();
        try {
            let result: ReviewHarnessScenarioResult;
            if (id === "settings-lifecycle") {
                result = inspectSettingsLifecycle({
                    migration: this.runtime.getSettingsMigrationState(),
                    settings: this.runtime.getSettings(),
                    newVaultSettings: this.runtime.getNewVaultSettings(),
                });
            } else if (id === "p2p-composition") {
                result = inspectP2PComposition(this.runtime.getP2PComposition());
            } else if (id === "vault-round-trip") {
                result = await this.runtime.runVaultRoundTrip();
            } else {
                const inspection = this.inspectCompatibilityReview();
                result =
                    inspection.status === "failed" || !this.runtime.getCompatibilityPause()
                        ? inspection
                        : {
                              status: "waiting-for-user",
                              detail: "Open the device-local compatibility review and complete its explicit action.",
                              observations: inspection.observations,
                          };
            }
            this.results[id] = result;
            this.record("scenario-updated", `${id}:${result.status}`);
        } catch (error) {
            this.setUnexpectedFailure(id, error);
        } finally {
            this.running = false;
            this.current = null;
            this.notify();
        }
    }

    async openCompatibilityReview(): Promise<void> {
        if (this.running) return;
        this.running = true;
        this.current = "compatibility-review";
        this.notify();
        try {
            await this.runtime.openCompatibilityReview();
            const inspection = this.inspectCompatibilityReview();
            this.results["compatibility-review"] =
                inspection.status === "passed" && !this.runtime.getCompatibilityPause()
                    ? {
                          status: "passed",
                          detail: "The device-local compatibility pause was reviewed and cleared.",
                          observations: inspection.observations,
                      }
                    : inspection.status === "failed"
                      ? inspection
                      : {
                            status: "waiting-for-user",
                            detail: "The device-local compatibility review remains pending.",
                            observations: inspection.observations,
                        };
            this.record(
                "compatibility-review-updated",
                this.results["compatibility-review"].status
            );
        } catch (error) {
            this.setUnexpectedFailure("compatibility-review", error);
        } finally {
            this.running = false;
            this.current = null;
            this.notify();
        }
    }

    private setUnexpectedFailure(id: ReviewHarnessScenarioId, error: unknown): void {
        this.runtime.reportError(error);
        this.results[id] = {
            status: "failed",
            detail: "The scenario failed unexpectedly. Review the in-app logs for diagnostic details.",
            observations: [],
        };
        this.record("scenario-failed", id);
    }

    prepareCompatibilityReviewRestart(): void {
        const requestedAt = this.runtime.now().toISOString();
        const pending = {
            formatVersion: 1,
            requestId: `compatibility-review-${requestedAt}`,
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt,
        } as const;
        this.runtime.writeContinuation(JSON.stringify(pending));
        this.results["compatibility-review"] = {
            status: "waiting-for-user",
            detail: "Restart requested. The one-shot continuation will be removed before the review resumes.",
            observations: [],
        };
        this.record("restart-requested", pending.requestId);
        this.notify();
        this.runtime.restart();
    }

    createReport(): string {
        return formatReviewHarnessReport({
            generatedAt: this.runtime.now().toISOString(),
            environment: this.runtime.getEnvironment(),
            scenarios: REVIEW_HARNESS_SCENARIOS.map(({ id, title, mode }) => ({
                id,
                title,
                mode,
                status: this.results[id].status,
                detail: this.results[id].detail,
            })),
            transcript: this.transcript,
        });
    }

    async copyReport(): Promise<void> {
        await this.runtime.copyText(this.createReport());
        this.record("report-copied");
        this.notify();
    }
}

export { REVIEW_HARNESS_STATE_KEY };
