import { reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { createDeferredAction, type TimeoutScheduler } from "octagonal-wheels/concurrency/deferredAction";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    STATUS_COUNTER_INACTIVE_LINGER_MS,
    createChunkFetchCounterLabel,
    createMinimumVisibleActivityCount,
    createPaddedCounterLabel,
} from "./StatusBarDisplay.ts";

vi.mock("octagonal-wheels/concurrency/deferredAction", { spy: true });

function createdControllers() {
    return vi.mocked(createDeferredAction).mock.results.map((result) => {
        if (result.type !== "return") throw new Error("Expected a real timeout controller");
        return result.value;
    });
}

function createScheduler() {
    const entries: { callback: () => void; delayMs: number; cancel: ReturnType<typeof vi.fn> }[] = [];
    const schedule = vi.fn<TimeoutScheduler>((callback, delayMs) => {
        const cancel = vi.fn();
        entries.push({ callback, delayMs, cancel });
        return cancel;
    });
    return { schedule, entries };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
});

afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("status timeout composition", () => {
    it("uses the real shared controller for minimum visibility, resumption, and disposal", () => {
        const scheduler = createScheduler();
        const source = reactiveSource(0);
        const display = createMinimumVisibleActivityCount(source, 150, scheduler.schedule);
        expect(createDeferredAction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), scheduler.schedule);
        const controller = createdControllers()[0];
        const schedule = vi.spyOn(controller, "schedule");
        const cancel = vi.spyOn(controller, "cancel");
        const dispose = vi.spyOn(controller, "dispose");

        source.value = 1;
        vi.advanceTimersByTime(50);
        source.value = 0;
        expect(schedule).toHaveBeenCalledExactlyOnceWith(100);
        expect(scheduler.entries[0].delayMs).toBe(100);
        source.value = 2;
        expect(cancel).toHaveBeenCalledTimes(3);
        expect(scheduler.entries[0].cancel).toHaveBeenCalledTimes(1);
        scheduler.entries[0].callback();
        expect(display.value).toBe(2);

        source.value = 0;
        scheduler.entries[1].callback();
        expect(display.value).toBe(0);
        source.value = 3;
        source.value = 0;
        display.dispose();
        display.dispose();
        scheduler.entries[2].callback();
        expect(display.value).toBe(3);
        expect(scheduler.entries[2].cancel).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("uses the shared controller for the counter linger and cancels through it when activity resumes", () => {
        const scheduler = createScheduler();
        const source = reactiveSource(0);
        const display = createPaddedCounterLabel(source, "A", 25, scheduler.schedule);
        expect(createDeferredAction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), scheduler.schedule);
        const controller = createdControllers()[0];
        const schedule = vi.spyOn(controller, "schedule");
        const cancel = vi.spyOn(controller, "cancel");
        const dispose = vi.spyOn(controller, "dispose");
        source.value = 1;
        source.value = 0;
        expect(schedule).toHaveBeenCalledExactlyOnceWith(25);
        source.value = 2;
        expect(cancel).toHaveBeenCalledTimes(3);
        expect(scheduler.entries[0].cancel).toHaveBeenCalledTimes(1);
        scheduler.entries[0].callback();
        expect(display.value).toBe(" A\u20072");
        expect(display.count.value).toBe(2);

        source.value = 0;
        scheduler.entries[1].callback();
        expect(display.value).toBe("");
        expect(display.count.value).toBeUndefined();
        source.value = 3;
        source.value = 0;
        display.dispose();
        scheduler.entries[2].callback();
        expect(display.value).toBe(" A\u20070");
        expect(display.count.value).toBe(0);
        expect(scheduler.entries[2].cancel).toHaveBeenCalledTimes(1);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("passes the scheduler to independent chunk-count controllers and disposes both children", () => {
        const scheduler = createScheduler();
        const source = reactiveSource({ initial: 2, retrying: 3 });
        const display = createChunkFetchCounterLabel(source, scheduler.schedule);
        expect(display.initialCount.value).toBe(2);
        expect(display.retryingCount.value).toBe(3);
        expect(createDeferredAction).toHaveBeenCalledTimes(2);
        expect(vi.mocked(createDeferredAction).mock.calls.map((args) => args[1])).toEqual([
            scheduler.schedule,
            scheduler.schedule,
        ]);
        const controllers = createdControllers();
        const disposers = controllers.map((controller) => vi.spyOn(controller, "dispose"));
        source.value = { initial: 0, retrying: 0 };
        expect(scheduler.entries.map((entry) => entry.delayMs)).toEqual([
            STATUS_COUNTER_INACTIVE_LINGER_MS,
            STATUS_COUNTER_INACTIVE_LINGER_MS,
        ]);
        scheduler.entries[0].callback();
        expect(display.value.replace(/\u2007/g, "")).toBe(" 🔁0");
        expect(display.initialCount.value).toBeUndefined();
        expect(display.retryingCount.value).toBe(0);
        display.dispose();
        display.dispose();
        expect(scheduler.entries[0].cancel).not.toHaveBeenCalled();
        expect(scheduler.entries[1].cancel).toHaveBeenCalledTimes(1);
        for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
        scheduler.entries[1].callback();
        expect(display.value.replace(/\u2007/g, "")).toBe(" 🔁0");
        expect(display.initialCount.value).toBeUndefined();
        expect(display.retryingCount.value).toBe(0);
    });
});
