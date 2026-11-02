import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigScanQueue } from "./ConfigScanQueue";

const queues: { stop(): Promise<void> }[] = [];
const releases: (() => void)[] = [];

function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    releases.push(resolve);
    return { promise, resolve };
}

function queue<T>(options: ConstructorParameters<typeof ConfigScanQueue<T>>[0]) {
    const result = new ConfigScanQueue(options);
    queues.push(result);
    return result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
    for (const release of releases.splice(0)) release();
    await Promise.all(queues.splice(0).map((item) => item.stop().catch(() => {})));
    vi.useRealTimers();
});

describe("ConfigScanQueue", () => {
    it("waits from the first arrival without extending the delay for later arrivals", async () => {
        const seen: string[] = [];
        const scans = queue<string>({
            process: (item) => {
                seen.push(item);
            },
        });
        scans.enqueue("first");
        await vi.advanceTimersByTimeAsync(50);
        scans.enqueue("second");
        await vi.advanceTimersByTimeAsync(49);
        expect(seen).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await scans.waitForIdle();
        expect(seen).toEqual(["first", "second"]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("bypasses the delay only when pending work exceeds ten items", async () => {
        const seen: number[] = [];
        const scans = queue<number>({
            process: (item) => {
                seen.push(item);
            },
        });
        for (let item = 0; item < 10; item++) scans.enqueue(item);
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual([]);
        scans.enqueue(10);
        await vi.advanceTimersByTimeAsync(0);
        await scans.waitForIdle();
        expect(seen).toEqual(Array.from({ length: 11 }, (_, index) => index));
        expect(vi.getTimerCount()).toBe(0);
    });

    it("keeps duplicate items in FIFO order and admits at most ten active scans", async () => {
        const finish = Array.from({ length: 13 }, () => gate());
        const input = Array.from({ length: 13 }, (_, index) => index % 3);
        const seen: number[] = [];
        let active = 0;
        let maximum = 0;
        const progress: number[] = [];
        const scans = queue<number>({
            process: async (item) => {
                const index = seen.length;
                seen.push(item);
                maximum = Math.max(maximum, ++active);
                await finish[index].promise;
                active--;
            },
            onProgress: (remaining) => progress.push(remaining),
        });
        input.forEach((item) => scans.enqueue(item));
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual(input.slice(0, 10));
        expect(scans.remaining).toBe(13);
        finish[3].resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual(input.slice(0, 11));
        finish.forEach((item) => item.resolve());
        await scans.waitForIdle();
        expect(seen).toEqual(input);
        expect(maximum).toBe(10);
        expect(scans.remaining).toBe(0);
        expect(progress[progress.length - 1]).toBe(0);
    });

    it("starts a later arrival in a free slot before an earlier slow scan finishes", async () => {
        const slow = gate();
        const seen: string[] = [];
        const scans = queue<string>({
            process: async (item) => {
                seen.push(item);
                if (item === "slow") await slow.promise;
            },
        });
        scans.enqueue("slow");
        await vi.advanceTimersByTimeAsync(100);
        let idle = false;
        const done = scans.waitForIdle().then(() => {
            idle = true;
        });
        scans.enqueue("later");
        await vi.advanceTimersByTimeAsync(100);
        expect(seen).toEqual(["slow", "later"]);
        expect(idle).toBe(false);
        slow.resolve();
        await done;
        expect(scans.remaining).toBe(0);
    });

    it("clears delayed scans and gives replacement work its own delay", async () => {
        const seen: string[] = [];
        const scans = queue<string>({
            process: (item) => {
                seen.push(item);
            },
        });
        scans.enqueue("old");
        await vi.advanceTimersByTimeAsync(50);
        scans.clearPending();
        expect(scans.remaining).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        await scans.waitForIdle();
        scans.enqueue("new");
        await vi.advanceTimersByTimeAsync(99);
        expect(seen).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await scans.waitForIdle();
        expect(seen).toEqual(["new"]);
    });

    it("discards all unstarted work while active scans remain tracked", async () => {
        const finish = gate();
        const seen: number[] = [];
        const scans = queue<number>({
            process: async (item) => {
                seen.push(item);
                await finish.promise;
            },
        });
        for (let item = 0; item < 50; item++) scans.enqueue(item);
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toHaveLength(10);
        scans.clearPending();
        expect(scans.remaining).toBe(10);
        let idle = false;
        const done = scans.waitForIdle().then(() => {
            idle = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(idle).toBe(false);
        finish.resolve();
        await done;
        expect(seen).toEqual(Array.from({ length: 10 }, (_, index) => index));
        expect(scans.remaining).toBe(0);
    });

    it("invalidates prefetched work after clearing and admits replacements alongside active scans", async () => {
        const finishFirst = gate();
        const finishReplacement = gate();
        let scans!: ConfigScanQueue<string>;
        const seen: string[] = [];
        scans = queue<string>({
            process: async (item) => {
                seen.push(item);
                if (item === "first") {
                    void Promise.resolve().then(() => Promise.resolve().then(() => scans.clearPending()));
                    await finishFirst.promise;
                } else if (item === "replacement") {
                    await finishReplacement.promise;
                }
            },
        });
        scans.enqueue("first");
        scans.enqueue("stale");
        await vi.advanceTimersByTimeAsync(100);
        expect(seen).toEqual(["first"]);
        expect(scans.remaining).toBe(1);

        scans.enqueue("replacement");
        await vi.advanceTimersByTimeAsync(100);
        expect(seen).toEqual(["first", "replacement"]);
        expect(scans.remaining).toBe(2);

        finishFirst.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(scans.remaining).toBe(1);
        finishReplacement.resolve();
        await scans.waitForIdle();
        expect(scans.remaining).toBe(0);
    });

    it("keeps the ten-scan limit across clear and replacement work", async () => {
        const finish = Array.from({ length: 12 }, () => gate());
        const seen: number[] = [];
        let active = 0;
        let maximum = 0;
        const scans = queue<number>({
            process: async (item) => {
                seen.push(item);
                maximum = Math.max(maximum, ++active);
                await finish[item].promise;
                active--;
            },
        });
        for (let item = 0; item < 10; item++) scans.enqueue(item);
        await vi.advanceTimersByTimeAsync(100);
        expect(seen).toEqual(Array.from({ length: 10 }, (_, index) => index));

        scans.clearPending();
        scans.enqueue(10);
        scans.enqueue(11);
        await vi.advanceTimersByTimeAsync(100);
        expect(seen).toEqual(Array.from({ length: 10 }, (_, index) => index));
        expect(maximum).toBe(10);

        finish[0].resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(seen).toEqual(Array.from({ length: 11 }, (_, index) => index));
        expect(maximum).toBe(10);
        finish.forEach((item) => item.resolve());
        await scans.waitForIdle();
        expect(seen).toEqual(Array.from({ length: 12 }, (_, index) => index));
        expect(maximum).toBe(10);
    });

    it("stops while waiting for input, joins active work, and rejects later admission", async () => {
        const finish = gate();
        const seen: number[] = [];
        const scans = queue<number>({
            process: async (item) => {
                seen.push(item);
                await finish.promise;
            },
        });
        scans.enqueue(1);
        await vi.advanceTimersByTimeAsync(100);
        scans.enqueue(2);
        let stopped = false;
        const done = scans.stop().then(() => {
            stopped = true;
        });
        expect(() => scans.enqueue(3)).toThrow("closed");
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(0);
        expect(stopped).toBe(false);
        finish.resolve();
        await done;
        expect(seen).toEqual([1]);
        expect(scans.remaining).toBe(0);
        await scans.stop();
    });

    it("stops before the first scan without leaving a timer", async () => {
        const process = vi.fn();
        const scans = queue({ process });
        scans.enqueue("pending");
        await scans.stop();
        await vi.advanceTimersByTimeAsync(100);
        expect(process).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("observes an unhandled item failure after other started work settles", async () => {
        const fail = gate();
        const finish = gate();
        const failure = new Error("read failed");
        const seen: number[] = [];
        const scans = queue<number>({
            process: async (item) => {
                seen.push(item);
                if (item === 0) {
                    await fail.promise;
                    throw failure;
                }
                await finish.promise;
            },
        });
        for (let item = 0; item < 12; item++) scans.enqueue(item);
        await vi.advanceTimersByTimeAsync(0);
        let error: unknown;
        const done = scans.waitForIdle().catch((reason: unknown) => {
            error = reason;
        });
        fail.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(error).toBeUndefined();
        expect(seen).toHaveLength(10);
        expect(() => scans.enqueue(12)).toThrow("closed");
        finish.resolve();
        await done;
        expect(error).toBe(failure);
        expect(scans.remaining).toBe(2);
    });

    it("includes work enqueued by an active scan in an existing idle wait", async () => {
        const seen: string[] = [];
        const scans = queue<string>({
            process: (item) => {
                seen.push(item);
                if (item === "first") scans.enqueue("follow-up");
            },
        });
        scans.enqueue("first");
        let idle = false;
        const done = scans.waitForIdle().then(() => {
            idle = true;
        });
        await vi.advanceTimersByTimeAsync(100);
        expect(seen).toEqual(["first"]);
        expect(idle).toBe(false);
        await vi.advanceTimersByTimeAsync(100);
        await done;
        expect(seen).toEqual(["first", "follow-up"]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("wakes an input wait when its only active scan fails", async () => {
        const finish = gate();
        const failure = new Error("read failed");
        const scans = queue<string>({
            process: async () => {
                await finish.promise;
                throw failure;
            },
        });
        scans.enqueue("only");
        await vi.advanceTimersByTimeAsync(100);
        const done = expect(scans.waitForIdle()).rejects.toBe(failure);
        finish.resolve();
        await done;
        expect(scans.remaining).toBe(0);
    });

    it("rejects an existing idle wait if observing completion fails", async () => {
        const finish = gate();
        const failure = new Error("observer failed");
        const scans = queue<string>({
            process: () => finish.promise,
            onProgress: (remaining) => {
                if (remaining === 0) throw failure;
            },
        });
        scans.enqueue("active");
        await vi.advanceTimersByTimeAsync(100);
        const done = expect(scans.waitForIdle()).rejects.toBe(failure);
        finish.resolve();
        await done;
        expect(scans.remaining).toBe(0);
    });

    it("retains both an observer failure and a later failure from active work", async () => {
        const finish = gate();
        const observerFailure = new Error("observer failed");
        const readFailure = new Error("read failed");
        const scans = queue<string>({
            process: async () => {
                await finish.promise;
                throw readFailure;
            },
            onProgress: (remaining) => {
                if (remaining === 2) throw observerFailure;
            },
        });
        scans.enqueue("active");
        await vi.advanceTimersByTimeAsync(100);
        scans.enqueue("pending");
        const done = expect(scans.waitForIdle()).rejects.toMatchObject({
            message: "Customisation scans failed.",
            errors: [observerFailure, readFailure],
        });
        finish.resolve();
        await done;
    });

    it("wakes an idle waiter when the progress observer fails", async () => {
        const failure = new Error("observer failed");
        const process = vi.fn();
        const scans = queue<string>({
            process,
            onProgress: () => {
                throw failure;
            },
        });
        scans.enqueue("pending");
        await expect(scans.waitForIdle()).rejects.toBe(failure);
        expect(process).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
