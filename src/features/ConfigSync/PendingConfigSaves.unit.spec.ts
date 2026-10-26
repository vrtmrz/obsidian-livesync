import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingConfigSaves } from "./PendingConfigSaves";

function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("pending customisation saves", () => {
    it("retains the quiet period and completes every coalesced notification after the actual save", async () => {
        vi.useFakeTimers();
        const pending = new PendingConfigSaves();
        const save = deferred();
        const firstSave = vi.fn(async () => {});
        const lastSave = vi.fn(() => save.promise);
        const first = pending.enqueue("plugin", firstSave);
        await vi.advanceTimersByTimeAsync(80);
        const second = pending.enqueue("plugin", lastSave);
        let completed = false;
        const all = Promise.all([first, second]).then(() => {
            completed = true;
        });
        await vi.advanceTimersByTimeAsync(99);
        expect(lastSave).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(firstSave).not.toHaveBeenCalled();
        expect(lastSave).toHaveBeenCalledOnce();
        expect(completed).toBe(false);
        save.resolve();
        await all;
        expect(completed).toBe(true);
    });

    it("flushes the captured group without waiting for or releasing later notifications", async () => {
        vi.useFakeTimers();
        const pending = new PendingConfigSaves();
        const flush = deferred();
        const lateFlush = deferred();
        const firstSave = deferred();
        const work = vi.fn(() => firstSave.promise);
        const first = pending.enqueue("plugin", work, flush.promise);
        const coalesced = pending.enqueue("plugin", work, lateFlush.promise);
        flush.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(work).toHaveBeenCalledOnce();
        const nextWork = vi.fn(async () => {});
        const later = pending.enqueue("plugin", nextWork);
        lateFlush.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(nextWork).not.toHaveBeenCalled();
        firstSave.resolve();
        await Promise.all([first, coalesced]);
        expect(nextWork).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        await later;
        expect(nextWork).toHaveBeenCalledOnce();
    });

    it("rejects every coalesced notification with the original failure and permits a later retry", async () => {
        vi.useFakeTimers();
        const pending = new PendingConfigSaves();
        const failure = new Error("database write failed");
        const save = async () => {
            throw failure;
        };
        const first = pending.enqueue("plugin", save);
        const second = pending.enqueue("plugin", save);
        const outcomes = Promise.allSettled([first, second]);
        await vi.advanceTimersByTimeAsync(100);
        expect(await outcomes).toEqual([
            { status: "rejected", reason: failure },
            { status: "rejected", reason: failure },
        ]);
        const retry = pending.enqueue("plugin", async () => {}, Promise.resolve());
        await retry;
    });
});
