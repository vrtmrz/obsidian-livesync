import type { ReviewHarnessScenarioResult } from "./reviewHarnessTypes";

export type DatabaseProbeMode = "controlled" | "background";
export type DatabaseProbeAction = "close-native" | "check" | "reopen" | "finish" | "cancel";
export type DatabaseProbeStage =
    | "baseline"
    | "manual-check"
    | "after-native-close"
    | "after-explicit-reopen"
    | "background-transition";

export interface DatabaseProbeSnapshot {
    readonly mode: DatabaseProbeMode | null;
    readonly phase: "idle" | "preparing" | "observing" | "checking" | "finishing" | "complete";
    readonly instruction: string;
    readonly expected: string;
    readonly availableActions: readonly DatabaseProbeAction[];
    readonly result: ReviewHarnessScenarioResult;
}

/** The guided view receives fixed actions, never database names or executable input. */
export interface ReviewHarnessDatabaseProbe {
    snapshot(): DatabaseProbeSnapshot;
    subscribe(listener: () => void): () => void;
    start(mode: DatabaseProbeMode): Promise<void>;
    perform(action: DatabaseProbeAction): Promise<void>;
    dispose(): Promise<void>;
}
