// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 05d4714
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive";
export type TrackedPhysicalRequestCounters = {
    requestCount: ReactiveSource<number>;
    responseCount: ReactiveSource<number>;
};
/**
 * Tracks one physical-request unit for status reporting.
 *
 * A unit may be an exact transport attempt or a higher-level SDK command. The
 * resulting in-flight count is deliberately approximate and must not be used
 * for protocol correctness, throttling, or completion decisions.
 */
export declare function runWithTrackedPhysicalRequest<T>(counters: TrackedPhysicalRequestCounters, task: () => T | PromiseLike<T>): Promise<T>;
