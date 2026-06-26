// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { PeriodicProcessor } from "@/common/PeriodicProcessor";
import { type NecessaryObsidianFeature } from "@/types";
export type PeriodicReplicationHost = NecessaryObsidianFeature<"appLifecycle" | "setting" | "replication" | "control" | "API">;
export declare const disablePeriodicHandler: (processor: PeriodicProcessor | undefined) => Promise<boolean>;
export declare const resumePeriodicHandler: (host: PeriodicReplicationHost, processor: PeriodicProcessor) => Promise<boolean>;
export declare function usePeriodicReplication(host: PeriodicReplicationHost): {
    disablePeriodic: () => Promise<boolean>;
    resumePeriodic: () => Promise<boolean>;
};
