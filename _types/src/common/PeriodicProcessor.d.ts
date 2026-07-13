// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: ef1bdf0
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
type PeriodicProcessorHost = NecessaryServices<"API" | "control", never>;
export declare class PeriodicProcessor {
    _process: () => Promise<unknown>;
    _timer?: number;
    _core: PeriodicProcessorHost;
    constructor(core: PeriodicProcessorHost, process: () => Promise<unknown>);
    process(): Promise<void>;
    enable(interval: number): void;
    disable(): void;
}
export {};
