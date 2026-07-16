// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: bbf2539
/** Options attached to one bounded asynchronous activity. */
export interface AsyncActivityOptions {
    /** An optional diagnostic label supplied to the activity owner. */
    label?: string;
}
/**
 * Runs bounded asynchronous work inside a consumer-owned activity scope.
 *
 * The common library deliberately does not prescribe what the scope does. A
 * browser host may keep the screen awake, while a headless host may omit the
 * runner and execute the task directly.
 */
export interface AsyncActivityRunner {
    /** Runs the task and returns its result without changing its error semantics. */
    run<T>(task: () => T | PromiseLike<T>, options?: AsyncActivityOptions): Promise<T>;
}
/** Runs a task through the injected activity owner, or directly when none is supplied. */
export declare function runWithOptionalActivity<T>(runner: AsyncActivityRunner | undefined, task: () => T | PromiseLike<T>, options?: AsyncActivityOptions): Promise<T>;
