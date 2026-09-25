import { describe, expect, it } from "vitest";
import { createIssue1189Diagnostics } from "./issue1189Diagnostics";

function makeStorage() {
    const items = new Map<string, string>();
    return {
        items,
        getDeviceLocalConfig: (key: string) => items.get(key) ?? null,
        setDeviceLocalConfig: (key: string, value: string) => {
            items.set(key, value);
        },
    };
}

describe("Issue 1189 diagnostic record", () => {
    it("keeps an interrupted reflection readable across startup and pauses its retry", () => {
        const storage = makeStorage();
        let clock = 1000;
        const first = createIssue1189Diagnostics(storage, "Vault", "normal", () => clock);
        first.markPhase("fetch");
        first.markPhase("reflect");
        first.onFileActivity({ phase: "start", size: 40_000_000 });

        clock += 1000;
        const second = createIssue1189Diagnostics(storage, "Vault", "normal", () => clock);
        expect(second.shouldPauseFetch()).toBe(true);
        second.pause();
        const record = JSON.parse(second.report());
        expect(record.previous.phase).toBe("reflect");
        expect(record.previous.peakActiveBytes).toBe(40_000_000);

        clock += 1000;
        const third = createIssue1189Diagnostics(storage, "Vault", "serial", () => clock);
        expect(third.shouldPauseFetch()).toBe(true);
        third.allowResume();
        clock += 1000;
        const resumed = createIssue1189Diagnostics(storage, "Vault", "serial", () => clock);
        expect(resumed.shouldPauseFetch()).toBe(false);
    });

    it("does not pause after a requested restart or completed attempt", () => {
        const storage = makeStorage();
        const first = createIssue1189Diagnostics(storage, "Vault", "normal");
        first.markPhase("fetch");
        first.markRestartRequested();
        expect(createIssue1189Diagnostics(storage, "Vault", "normal").shouldPauseFetch()).toBe(false);

        const completed = createIssue1189Diagnostics(storage, "Other Vault", "serial");
        completed.markPhase("finalise");
        completed.markComplete();
        expect(createIssue1189Diagnostics(storage, "Other Vault", "serial").shouldPauseFetch()).toBe(false);
    });

    it("bounds the saved event history and measures timer delay", () => {
        const storage = makeStorage();
        let clock = 0;
        const diagnostics = createIssue1189Diagnostics(storage, "Vault", "normal", () => clock);
        for (let i = 0; i < 40; i++) diagnostics.markPhase("fetch");
        let tick: (() => void) | undefined;
        const stop = diagnostics.startTimer((callback) => {
            tick = callback;
            return 1;
        }, () => {});
        clock = 1500;
        tick?.();
        stop();
        const record = JSON.parse(diagnostics.report());
        expect(record.current.events).toHaveLength(24);
        expect(record.current.peakTimerDelayMs).toBe(500);
    });
});
