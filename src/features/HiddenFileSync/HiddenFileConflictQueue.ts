import { compatGlobal, type CompatTimeoutHandle } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { withCancellation } from "octagonal-wheels/concurrency/cancellation";
import { createNotifier } from "octagonal-wheels/concurrency/notifier";
import { forEachInScope } from "octagonal-wheels/concurrency/scoped.iteration";
import { createAsyncQueue } from "octagonal-wheels/iterable/asyncQueue";
import { withOwnedResource } from "octagonal-wheels/resource";

/** The scheduling used by one hidden-file conflict stage. */
class ConflictStage<T> {
    private readonly input = createAsyncQueue<T>();
    private readonly reader = this.input[Symbol.asyncIterator]();
    private readonly changed = createNotifier();
    private readonly cancellation = new AbortController();
    private timer: CompatTimeoutHandle | undefined;
    private ready = false;
    private suspended = false;
    private stopped = false;
    private outstanding = 0;
    active = 0;

    constructor(
        concurrency: number,
        process: (item: T) => Promise<unknown>,
        private readonly notify: () => void,
        onError: (error: unknown) => void,
        onFailure: (error: unknown) => void
    ) {
        // The operation owns its input until started callbacks have settled.
        // Abort also releases input immediately, before that final cleanup.
        void withCancellation(undefined, { signal: this.cancellation.signal }, (scope) => {
            const stopInput = () => {
                this.input.dispose();
                this.clearTimer();
                this.changed.notify();
            };
            scope.signal.addEventListener("abort", stopInput, { once: true });
            scope.defer(() => scope.signal.removeEventListener("abort", stopInput));
            return withOwnedResource(this.input, () =>
                forEachInScope(scope, this.availableItems(), { concurrency }, async (entry) => {
                    while (this.suspended && !this.stopped) await this.changed.wait();
                    if (this.stopped) return;
                    this.active++;
                    try {
                        await process(entry.value);
                    } catch (error) {
                        try {
                            onError(error);
                        } catch (reportingError) {
                            // Wake a pending input pull before the runner joins
                            // its other callbacks after an unexpected failure.
                            onFailure(reportingError);
                            throw reportingError;
                        }
                    } finally {
                        this.active--;
                        this.outstanding--;
                        this.notify();
                    }
                })
            );
        }).catch(onFailure);
    }

    get remaining() {
        return this.outstanding;
    }

    enqueue(item: T): boolean {
        if (this.stopped) return false;
        this.input.enqueue(item);
        this.outstanding++;
        this.schedule();
        this.notify();
        return true;
    }

    private clearTimer() {
        if (this.timer === undefined) return;
        compatGlobal.clearTimeout(this.timer);
        this.timer = undefined;
    }

    private schedule() {
        if (this.stopped || this.suspended || this.input.size === 0) return;
        if (this.ready || this.input.size > 10) {
            this.clearTimer();
            this.ready = true;
            this.changed.notify();
        } else if (this.timer === undefined) {
            this.timer = compatGlobal.setTimeout(() => {
                this.timer = undefined;
                this.ready = true;
                this.changed.notify();
            }, 10);
        }
    }

    private async *availableItems() {
        while (!this.stopped) {
            while (!this.stopped && (this.suspended || !this.ready || this.input.size === 0)) {
                await this.changed.wait();
            }
            if (this.stopped) return;
            const entry = await this.reader.next();
            if (entry.done) return;
            if (this.input.size === 0) {
                this.ready = false;
                this.clearTimer();
            }
            // Outstanding includes this pulled item until its callback finishes.
            yield { value: entry.value };
        }
    }

    suspend() {
        this.suspended = true;
        this.ready = false;
        this.clearTimer();
    }

    resume() {
        if (!this.suspended || this.stopped) return;
        this.suspended = false;
        this.schedule();
        this.changed.notify();
    }

    dispose() {
        if (this.stopped) return;
        this.stopped = true;
        this.outstanding = this.active;
        this.cancellation.abort();
        this.notify();
    }
}

/** Two hidden-file stages: five analyses, followed by one manual resolution. */
export class HiddenFileConflictQueue<T, U> {
    private readonly changed = createNotifier();
    private readonly analysis: ConflictStage<T>;
    private readonly resolution: ConflictStage<U>;
    private stopped = false;
    private failure: { error: unknown } | undefined;

    constructor(
        analyse: (item: T) => Promise<U[]>,
        resolve: (item: U) => Promise<unknown>,
        onError: (error: unknown) => void
    ) {
        const notify = () => this.changed.notify();
        const onFailure = (error: unknown) => {
            this.failure ??= { error };
            this.dispose();
        };
        this.resolution = new ConflictStage(1, resolve, notify, onError, onFailure);
        this.analysis = new ConflictStage(
            5,
            async (item) => {
                const results = await analyse(item);
                for (const result of results) this.resolution.enqueue(result);
            },
            notify,
            onError,
            onFailure
        );
    }

    enqueue(item: T): boolean {
        return this.analysis.enqueue(item);
    }

    get nowProcessing() {
        return this.analysis.active;
    }

    get remaining() {
        return this.analysis.remaining;
    }

    get totalRemaining() {
        return this.analysis.remaining + this.resolution.remaining;
    }

    suspend() {
        this.analysis.suspend();
    }

    startPipeline(): this {
        this.analysis.resume();
        return this;
    }

    /** Includes handoff and self-requeues; disposal is never successful drainage. */
    async waitForAllProcessed(): Promise<boolean> {
        this.startPipeline();
        while (!this.stopped && this.totalRemaining > 0) await this.changed.wait();
        if (this.failure) throw this.failure.error;
        return !this.stopped;
    }

    /** Stop admission and release pending work without waiting for active dialogue or writes. */
    dispose() {
        if (this.stopped) return;
        this.stopped = true;
        this.analysis.dispose();
        this.resolution.dispose();
        this.changed.notify();
    }
}
