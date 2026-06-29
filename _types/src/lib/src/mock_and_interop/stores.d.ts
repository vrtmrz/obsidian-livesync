// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LOG_LEVEL } from "@lib/common/types.ts";
export type LockStats = {
    pending: string[];
    running: string[];
    count: number;
};
export declare const lockStats: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<{
    pending: never[];
    running: never[];
    count: number;
}>;
export declare const collectingChunks: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
export declare const pluginScanningCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
export declare const hiddenFilesProcessingCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
export declare const hiddenFilesEventCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
export type LogEntry = {
    message: string | Error;
    level?: LOG_LEVEL;
    key?: string;
};
export declare const logMessages: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<string[]>;
