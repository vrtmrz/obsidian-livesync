export type ReviewHarnessScenarioStatus =
    | "idle"
    | "queued"
    | "running"
    | "waiting-for-user"
    | "passed"
    | "failed"
    | "cancelled";

export interface ReviewHarnessScenarioResult {
    readonly status: ReviewHarnessScenarioStatus;
    readonly detail: string;
    readonly observations: readonly string[];
}
