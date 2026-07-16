// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 96033e1
import { type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
export declare const STATUS_COUNTER_INACTIVE_LINGER_MS = 3000;
export type DisposableReactiveValue<T> = ReactiveValue<T> & {
    dispose(): void;
};
/**
 * Mirrors an activity count while keeping each visible period on screen for a
 * minimum total lifetime. The delay applies only when the source becomes zero.
 */
export declare function createMinimumVisibleActivityCount(source: ReactiveValue<number>, minimumVisibleMs: number): DisposableReactiveValue<number>;
/**
 * Formats a counter with a stable width and briefly retains its zero value so
 * that the completion of queued work remains visible.
 */
export declare function createPaddedCounterLabel(source: ReactiveValue<number>, mark: string, inactiveLingerMs?: number): DisposableReactiveValue<string>;
