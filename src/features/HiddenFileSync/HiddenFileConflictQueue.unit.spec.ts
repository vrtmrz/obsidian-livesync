import { afterEach, describe, expect, it, vi } from "vitest";
import { HiddenFileConflictQueue } from "./HiddenFileConflictQueue.ts";

const owners: { dispose(): void }[] = [];
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function own<T, U>(queue: HiddenFileConflictQueue<T, U>) {
    owners.push(queue);
    return queue;
}

afterEach(async () => {
    owners.splice(0).forEach((owner) => owner.dispose());
    if (vi.isFakeTimers()) await vi.runAllTimersAsync();
    vi.useRealTimers();
});

describe("HiddenFileConflictQueue", () => {
    it("awaits repeated handoffs and self-requeues with native timers", async () => {
        const seen: number[] = [];
        let queue!: HiddenFileConflictQueue<number, number>;
        queue = own(
            new HiddenFileConflictQueue(
                async (value: number) => [value],
                async (value) => {
                    seen.push(value);
                    if (value < 3) queue.enqueue(value + 1);
                },
                vi.fn()
            )
        );
        queue.enqueue(0);
        expect(await queue.waitForAllProcessed()).toBe(true);
        expect(seen).toEqual([0, 1, 2, 3]);
        expect(queue.totalRemaining).toBe(0);
    });

    it("uses the first arrival's ten-millisecond delay in each stage", async () => {
        vi.useFakeTimers();
        const analyse = vi.fn(async (value: number) => [value]);
        const resolve = vi.fn(async (_value: number) => {});
        const queue = own(new HiddenFileConflictQueue(analyse, resolve, vi.fn()));
        queue.enqueue(1);
        await vi.advanceTimersByTimeAsync(9);
        queue.enqueue(2);
        expect(analyse).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(analyse.mock.calls).toEqual([[1], [2]]);
        expect(resolve).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(9);
        expect(resolve).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(resolve.mock.calls).toEqual([[1], [2]]);
        expect(await queue.waitForAllProcessed()).toBe(true);
        expect(queue.totalRemaining).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("starts both stages immediately above ten waiting items", async () => {
        vi.useFakeTimers();
        const gate = deferred();
        const analyse = vi.fn(async (value: number) => [value]);
        const resolve = vi.fn(async (_value: number) => {
            await gate.promise;
        });
        const queue = own(new HiddenFileConflictQueue(analyse, resolve, vi.fn()));
        for (let value = 0; value < 11; value++) queue.enqueue(value);
        await vi.advanceTimersByTimeAsync(0);
        expect(analyse).toHaveBeenCalledTimes(11);
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(queue.totalRemaining).toBe(11);
        gate.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(resolve.mock.calls).toEqual(Array.from({ length: 11 }, (_, value) => [value]));
        expect(await queue.waitForAllProcessed()).toBe(true);
    });

    it("logs item failures in both stages and continues without implicit retry", async () => {
        vi.useFakeTimers();
        const first = new Error("analysis failed");
        const second = new Error("resolution failed");
        const analyse = vi.fn(async (value: number) => {
            if (value === 1) throw first;
            return [value];
        });
        const resolve = vi.fn(async (value: number) => {
            if (value === 2) throw second;
        });
        const onError = vi.fn();
        const queue = own(new HiddenFileConflictQueue(analyse, resolve, onError));
        [1, 2, 3].forEach((value) => queue.enqueue(value));
        await vi.advanceTimersByTimeAsync(20);
        expect(onError.mock.calls).toEqual([[first], [second]]);
        expect(analyse.mock.calls).toEqual([[1], [2], [3]]);
        expect(resolve.mock.calls).toEqual([[2], [3]]);
        expect(await queue.waitForAllProcessed()).toBe(true);
    });

    it("discards delayed input and releases idle waiters on disposal", async () => {
        vi.useFakeTimers();
        const analyse = vi.fn(async (value: number) => [value]);
        const resolve = vi.fn(async (_value: number) => {});
        const queue = own(new HiddenFileConflictQueue(analyse, resolve, vi.fn()));
        queue.enqueue(1);
        const idle = queue.waitForAllProcessed();
        queue.dispose();
        queue.dispose();
        expect(await idle).toBe(false);
        expect(queue.enqueue(2)).toBe(false);
        expect(queue.totalRemaining).toBe(0);
        await vi.advanceTimersByTimeAsync(100);
        expect(analyse).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not wait for active analysis or admit its late handoff and self-requeue after disposal", async () => {
        vi.useFakeTimers();
        const gate = deferred();
        const attempted: boolean[] = [];
        let finished = 0;
        const analyse = vi.fn(async (value: number) => {
            await gate.promise;
            attempted.push(queue.enqueue(value));
            finished++;
            return [value];
        });
        const resolve = vi.fn(async (_value: number) => {});
        const queue = own(new HiddenFileConflictQueue(analyse, resolve, vi.fn()));
        for (let value = 0; value < 12; value++) queue.enqueue(value);
        await vi.advanceTimersByTimeAsync(0);
        expect(analyse).toHaveBeenCalledTimes(5);
        const idle = queue.waitForAllProcessed();
        queue.dispose();
        expect(await idle).toBe(false);
        expect(finished).toBe(0);
        expect(queue.totalRemaining).toBe(5);
        gate.resolve();
        await vi.advanceTimersByTimeAsync(100);
        expect(finished).toBe(5);
        expect(attempted).toEqual([false, false, false, false, false]);
        expect(analyse).toHaveBeenCalledTimes(5);
        expect(resolve).not.toHaveBeenCalled();
        expect(queue.totalRemaining).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves an active dialogue running and discards the next dialogue", async () => {
        vi.useFakeTimers();
        const gate = deferred();
        let finished = false;
        const resolve = vi.fn(async (_value: number) => {
            await gate.promise;
            finished = true;
        });
        const queue = own(new HiddenFileConflictQueue(async (value: number) => [value], resolve, vi.fn()));
        queue.enqueue(1);
        queue.enqueue(2);
        await vi.advanceTimersByTimeAsync(20);
        expect(resolve).toHaveBeenCalledTimes(1);
        queue.dispose();
        expect(await queue.waitForAllProcessed()).toBe(false);
        expect(finished).toBe(false);
        gate.resolve();
        await vi.advanceTimersByTimeAsync(100);
        expect(finished).toBe(true);
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(queue.totalRemaining).toBe(0);
    });

    it("suspends analysis while already handed-off manual work continues", async () => {
        vi.useFakeTimers();
        const analyse = vi.fn(async (value: number) => [value]);
        const resolve = vi.fn(async (_value: number) => {});
        const queue = own(new HiddenFileConflictQueue(analyse, resolve, vi.fn()));
        queue.enqueue(1);
        await vi.advanceTimersByTimeAsync(10);
        queue.suspend();
        queue.enqueue(2);
        await vi.advanceTimersByTimeAsync(100);
        expect(analyse.mock.calls).toEqual([[1]]);
        expect(resolve.mock.calls).toEqual([[1]]);
        queue.startPipeline();
        await vi.advanceTimersByTimeAsync(20);
        expect(analyse.mock.calls).toEqual([[1], [2]]);
        expect(resolve.mock.calls).toEqual([[1], [2]]);
        expect(await queue.waitForAllProcessed()).toBe(true);
    });
});
