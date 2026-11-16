export type ReviewHarnessScenarioStatus =
    | "idle"
    | "queued"
    | "running"
    | "waiting-for-user"
    | "passed"
    | "failed"
    | "not-observed"
    | "unsupported"
    | "cancelled";

export interface ReviewHarnessScenarioResult {
    readonly status: ReviewHarnessScenarioStatus;
    readonly detail: string;
    readonly observations: readonly string[];
}
