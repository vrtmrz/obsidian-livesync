import { compatGlobal, type CompatTimeoutHandle } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import { createNotifier } from "octagonal-wheels/concurrency/notifier";
import { forEachInScope } from "octagonal-wheels/concurrency/scoped.iteration";
import { createAsyncQueue, type AsyncQueue } from "octagonal-wheels/iterable/asyncQueue";
import { withScope, type Awaitable } from "octagonal-wheels/resource/scope";

interface ConfigScanQueueOptions<T> {
    /** The caller logs recoverable item failures and decides whether to continue. */
    process: (item: T) => Awaitable<void>;
    onProgress?: (remaining: number) => void;
}

interface PendingQueue<T> {
    fifo: AsyncQueue<T>;
    iterator: AsyncIterator<T>;
}

interface PendingScan<T> {
    value: T;
    queue: PendingQueue<T>;
}

/** Owns FIFO admission, the initial scan delay, and completion for one catalogue. */
export class ConfigScanQueue<T> {
    private pending: PendingQueue<T>;
    private pendingCount = 0;
    private active = 0;
    private ready = false;
    private stopped = false;
    private stoppingAfterFailure = false;
    private readonly failures: unknown[] = [];
    private timer?: CompatTimeoutHandle;
    private running?: Promise<void>;
    private readonly changed = createNotifier();

    constructor(private readonly options: ConfigScanQueueOptions<T>) {
        this.pending = this.createPendingQueue();
    }

    private createPendingQueue(): PendingQueue<T> {
        const fifo = createAsyncQueue<T>();
        return { fifo, iterator: fifo[Symbol.asyncIterator]() };
    }

    get remaining(): number {
        return this.pendingCount + this.active;
    }

    enqueue(value: T): void {
        if (!this.canDispatch()) throw new Error("The customisation scan queue is closed.");
        this.pending.fifo.enqueue(value);
        this.pendingCount++;
        this.reportProgress();
        this.schedule();
    }

    /** Discard unstarted scans; active reads and migrations retain their slots. */
    clearPending(): void {
        const discarded = this.pending;
        this.pending = this.createPendingQueue();
        this.pendingCount = 0;
        this.ready = false;
        this.clearTimer();
        discarded.fifo.dispose();
        this.reportProgress();
    }

    /** Stop admission and join active work. A processor must not await its own stop. */
    stop(): Promise<void> {
        this.stopped = true;
        this.clearPending();
        return this.waitForIdle();
    }

    /** Include later arrivals until the queue is idle; this does not close admission. */
    async waitForIdle(): Promise<void> {
        this.schedule();
        while (this.running || this.timer !== undefined) await this.changed.wait();
        if (this.failures.length === 1) throw this.failures[0];
        if (this.failures.length > 1) {
            throw Object.assign(new Error("Customisation scans failed."), { errors: [...this.failures] });
        }
    }

    private canDispatch(): boolean {
        return !this.stopped && !this.stoppingAfterFailure;
    }

    private clearTimer(): void {
        if (this.timer === undefined) return;
        compatGlobal.clearTimeout(this.timer);
        this.timer = undefined;
    }

    private recordFailure(error: unknown): void {
        this.stoppingAfterFailure = true;
        this.failures.push(error);
        this.clearTimer();
        this.changed.notify();
    }

    private reportProgress(): void {
        if (this.failures.length === 0) {
            try {
                this.options.onProgress?.(this.remaining);
            } catch (error) {
                this.recordFailure(error);
            }
        }
        this.changed.notify();
    }

    private claim(entry: PendingScan<T>): boolean {
        if (!this.canDispatch() || this.pending !== entry.queue) return false;
        this.pendingCount--;
        if (this.pendingCount === 0) this.ready = false;
        return true;
    }

    private async *availableWork() {
        while (this.canDispatch()) {
            const pending = this.pending;
            if (!this.ready) {
                if (this.active === 0 && this.pendingCount === 0) return;
                await this.changed.wait();
                continue;
            }
            if (pending.fifo.size > 0) {
                const entry = await pending.iterator.next();
                if (entry.done) {
                    if (pending !== this.pending) continue;
                    return;
                }
                // The callback checks queue identity so clearing a pulled item cancels it.
                yield { value: entry.value, queue: pending };
            } else if (this.active > 0 || this.pendingCount > 0) {
                // Keep free slots available to later arrivals while a slow scan finishes.
                await this.changed.wait();
            } else {
                return;
            }
        }
    }

    private schedule(): void {
        if (!this.canDispatch() || this.pendingCount === 0) return;
        if (!this.ready) {
            if (this.pendingCount > 10) {
                this.ready = true;
                this.clearTimer();
            } else if (this.timer === undefined) {
                this.timer = compatGlobal.setTimeout(() => {
                    this.timer = undefined;
                    this.ready = true;
                    this.schedule();
                    this.changed.notify();
                }, 100);
            }
        }
        if (!this.ready || this.running) return;
        this.running = Promise.resolve()
            .then(() =>
                withScope(undefined, (parent) =>
                    forEachInScope(parent, this.availableWork(), { concurrency: 10 }, async (entry, child) => {
                        if (!this.claim(entry)) return;
                        this.active++;
                        child.defer(() => {
                            this.active--;
                            this.reportProgress();
                        });
                        this.reportProgress();
                        if (!this.canDispatch()) return;
                        try {
                            await this.options.process(entry.value);
                        } catch (error) {
                            this.stoppingAfterFailure = true;
                            this.clearTimer();
                            this.changed.notify();
                            throw error;
                        }
                    })
                )
            )
            .then(
                (): void => undefined,
                (error: unknown) => this.recordFailure(error)
            )
            .finally(() => {
                this.running = undefined;
                this.schedule();
                this.changed.notify();
            });
    }
}
