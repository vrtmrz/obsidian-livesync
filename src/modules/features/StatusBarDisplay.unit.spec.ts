import { reactive, reactiveSource } from "octagonal-wheels/dataobject/reactive";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    STATUS_COUNTER_INACTIVE_LINGER_MS,
    createMinimumVisibleActivityCount,
    createPaddedCounterLabel,
} from "./StatusBarDisplay.ts";

describe("createMinimumVisibleActivityCount", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-16T00:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps a short activity visible for the configured minimum lifetime", () => {
        const source = reactiveSource(0);
        const display = createMinimumVisibleActivityCount(source, 150);
        const rendered = reactive(() => `active:${display.value}`);

        expect(rendered.value).toBe("active:0");
        source.value = 1;
        expect(rendered.value).toBe("active:1");
        vi.advanceTimersByTime(50);
        source.value = 0;

        expect(display.value).toBe(1);
        vi.advanceTimersByTime(99);
        expect(display.value).toBe(1);
        vi.advanceTimersByTime(1);
        expect(display.value).toBe(0);
        expect(rendered.value).toBe("active:0");

        display.dispose();
    });

    it("updates overlapping activity and starts a new minimum lifetime after becoming idle", () => {
        const source = reactiveSource(0);
        const display = createMinimumVisibleActivityCount(source, 150);

        source.value = 1;
        vi.advanceTimersByTime(25);
        source.value = 2;
        expect(display.value).toBe(2);
        source.value = 0;

        vi.advanceTimersByTime(50);
        source.value = 1;
        expect(display.value).toBe(1);

        vi.advanceTimersByTime(75);
        source.value = 0;
        expect(display.value).toBe(0);

        source.value = 3;
        source.value = 0;
        expect(display.value).toBe(3);
        vi.advanceTimersByTime(150);
        expect(display.value).toBe(0);

        display.dispose();
    });

    it("cancels pending work and stops observing its source when disposed", () => {
        const source = reactiveSource(0);
        const display = createMinimumVisibleActivityCount(source, 150);

        source.value = 1;
        source.value = 0;
        display.dispose();
        vi.advanceTimersByTime(150);
        source.value = 2;

        expect(display.value).toBe(1);
    });
});

describe("createPaddedCounterLabel", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps the widest counter label until its inactive linger period ends", () => {
        const source = reactiveSource(0);
        const display = createPaddedCounterLabel(source, "📥");

        expect(display.value).toBe("");
        source.value = 9;
        expect(display.value).toBe(" 📥\u20079");
        source.value = 123;
        expect(display.value).toBe(" 📥\u2007123");
        source.value = 0;
        expect(display.value).toBe(" 📥\u2007\u2007\u20070");

        vi.advanceTimersByTime(STATUS_COUNTER_INACTIVE_LINGER_MS - 1);
        expect(display.value).toBe(" 📥\u2007\u2007\u20070");
        vi.advanceTimersByTime(1);
        expect(display.value).toBe("");

        source.value = 7;
        expect(display.value).toBe(" 📥\u20077");
        display.dispose();
    });

    it("cancels the pending clear when counter activity resumes", () => {
        const source = reactiveSource(0);
        const display = createPaddedCounterLabel(source, "📄");

        source.value = 1;
        source.value = 0;
        vi.advanceTimersByTime(1_000);
        source.value = 2;
        vi.advanceTimersByTime(STATUS_COUNTER_INACTIVE_LINGER_MS);

        expect(display.value).toBe(" 📄\u20072");
        display.dispose();
    });

    it("cancels its inactive timer and source subscription when disposed", () => {
        const source = reactiveSource(0);
        const display = createPaddedCounterLabel(source, "📄");

        source.value = 4;
        source.value = 0;
        display.dispose();
        vi.advanceTimersByTime(STATUS_COUNTER_INACTIVE_LINGER_MS);
        source.value = 5;

        expect(display.value).toBe(" 📄\u20070");
    });
});
