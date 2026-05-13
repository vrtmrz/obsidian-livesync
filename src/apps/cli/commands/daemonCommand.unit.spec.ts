import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "./runCommand";
import type { CLIOptions } from "./types";

// Mock performFullScan so daemon tests don't require a real CouchDB connection.
vi.mock("@lib/serviceFeatures/offlineScanner", () => ({
    performFullScan: vi.fn(async () => true),
}));

// Mock UnresolvedErrorManager to avoid event-hub side effects.
vi.mock("@lib/services/base/UnresolvedErrorManager", () => ({
    UnresolvedErrorManager: class UnresolvedErrorManager {
        showError() {}
        clearError() {}
        clearErrors() {}
    },
}));

import * as offlineScanner from "@lib/serviceFeatures/offlineScanner";

function createCoreMock() {
    return {
        services: {
            control: {
                activated: Promise.resolve(),
                applySettings: vi.fn(async () => {}),
            },
            setting: {
                applyPartial: vi.fn(async () => {}),
                currentSettings: vi.fn(() => ({ liveSync: true, syncOnStart: false })),
            },
            replication: {
                replicate: vi.fn(async () => true),
            },
            appLifecycle: {
                onUnload: {
                    addHandler: vi.fn(),
                },
            },
        },
        serviceModules: {
            fileHandler: {
                dbToStorage: vi.fn(async () => true),
                storeFileToDB: vi.fn(async () => true),
            },
            storageAccess: {
                readFileAuto: vi.fn(async () => ""),
                writeFileAuto: vi.fn(async () => {}),
            },
            databaseFileAccess: {
                fetch: vi.fn(async () => undefined),
            },
        },
    } as any;
}

function makeDaemonOptions(interval?: number): CLIOptions {
    return {
        command: "daemon",
        commandArgs: [],
        databasePath: "/tmp/vault",
        verbose: false,
        force: false,
        interval,
    };
}

const baseContext = {
    vaultPath: "/tmp/vault",
    settingsPath: "/tmp/vault/.livesync/settings.json",
    originalSyncSettings: {
        liveSync: true,
        syncOnStart: false,
        periodicReplication: false,
        syncOnSave: false,
        syncOnEditorSave: false,
        syncOnFileOpen: false,
        syncAfterMerge: false,
    },
} as any;

describe("daemon command", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("calls performFullScan during startup", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);

        await runCommand(makeDaemonOptions(), { ...baseContext, core });

        expect(offlineScanner.performFullScan).toHaveBeenCalledTimes(1);
    });

    it("returns false when performFullScan fails", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(false);

        const result = await runCommand(makeDaemonOptions(), { ...baseContext, core });

        expect(result).toBe(false);
    });

    it("polling mode: calls setTimeout when interval option is set", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);
        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

        await runCommand(makeDaemonOptions(30), { ...baseContext, core });

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        // Interval should be in milliseconds (30s → 30000ms)
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    it("polling mode: applies settings with suspendFileWatching=false before setting interval", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);

        await runCommand(makeDaemonOptions(10), { ...baseContext, core });

        expect(core.services.setting.applyPartial).toHaveBeenCalledWith(
            expect.objectContaining({ suspendFileWatching: false }),
            true
        );
        expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
    });

    it("liveSync mode: calls applyPartial and applySettings", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);

        await runCommand(makeDaemonOptions(), { ...baseContext, core });

        expect(core.services.setting.applyPartial).toHaveBeenCalledWith(
            expect.objectContaining({
                ...baseContext.originalSyncSettings,
                suspendFileWatching: false,
            }),
            true
        );
        expect(core.services.control.applySettings).toHaveBeenCalledTimes(1);
    });

    it("liveSync mode: logs warning when both liveSync and syncOnStart are false", async () => {
        const core = createCoreMock();
        core.services.setting.currentSettings = vi.fn(() => ({
            liveSync: false,
            syncOnStart: false,
        }));
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await runCommand(makeDaemonOptions(), { ...baseContext, core });

        expect(result).toBe(true);
        const warningCalls = consoleSpy.mock.calls.filter(
            (args) => typeof args[0] === "string" && args[0].includes("liveSync and syncOnStart are both disabled")
        );
        expect(warningCalls.length).toBeGreaterThan(0);
    });

    it("liveSync mode: no warning when liveSync is true", async () => {
        const core = createCoreMock();
        core.services.setting.currentSettings = vi.fn(() => ({
            liveSync: true,
            syncOnStart: false,
        }));
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        await runCommand(makeDaemonOptions(), { ...baseContext, core });

        const warningCalls = consoleSpy.mock.calls.filter(
            (args) => typeof args[0] === "string" && args[0].includes("liveSync and syncOnStart are both disabled")
        );
        expect(warningCalls.length).toBe(0);
    });

    it("calls replicate before performFullScan", async () => {
        const core = createCoreMock();
        const callOrder: string[] = [];
        core.services.replication.replicate = vi.fn(async () => {
            callOrder.push("replicate");
            return true;
        });
        vi.mocked(offlineScanner.performFullScan).mockImplementation(async () => {
            callOrder.push("performFullScan");
            return true;
        });

        await runCommand(makeDaemonOptions(), { ...baseContext, core });

        expect(callOrder).toEqual(["replicate", "performFullScan"]);
    });

    it("returns false when initial replication fails", async () => {
        const core = createCoreMock();
        core.services.replication.replicate = vi.fn(async () => false);
        vi.mocked(offlineScanner.performFullScan).mockClear();

        const result = await runCommand(makeDaemonOptions(), { ...baseContext, core });

        expect(result).toBe(false);
        // performFullScan should NOT have been called
        expect(offlineScanner.performFullScan).not.toHaveBeenCalled();
    });

    it("polling mode: registers onUnload handler that clears timeout", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);

        await runCommand(makeDaemonOptions(10), { ...baseContext, core });

        // onUnload handler should have been registered
        expect(core.services.appLifecycle.onUnload.addHandler).toHaveBeenCalledTimes(1);
        const handler = core.services.appLifecycle.onUnload.addHandler.mock.calls[0][0];

        // Get the timeout ID that was created
        const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
        await handler();
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    it("polling backoff: interval escalates on failure, caps at 300000ms, then halves on recovery", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);
        vi.spyOn(console, "error").mockImplementation(() => {});

        // startup replicate (call 1) succeeds; poll calls 2–7 fail; call 8 succeeds.
        let callCount = 0;
        core.services.replication.replicate = vi.fn(async () => {
            callCount++;
            if (callCount === 1) return true; // initial startup replicate
            if (callCount <= 7) throw new Error("network failure");
            return true; // recovery
        });

        const baseMs = 30 * 1000;
        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

        await runCommand(makeDaemonOptions(30), { ...baseContext, core });

        // After runCommand returns the first setTimeout has been scheduled.
        // setTimeoutSpy.mock.calls[0] is the initial schedule (baseMs).
        expect(setTimeoutSpy.mock.calls[0][1]).toBe(baseMs);

        // Advance through 6 failure polls. After each failure the next setTimeout
        // should be scheduled with a larger (or capped) interval.
        // formula: min(base * 2^n, 300000). base=30000ms.
        // failure 1: 30000*2=60000, failure 2: 30000*4=120000,
        // failure 3: 30000*8=240000, failure 4: 30000*16=480000→capped, 5→cap, 6→cap
        const expectedIntervals = [
            baseMs * 2,   // after failure 1: 60000
            baseMs * 4,   // after failure 2: 120000
            baseMs * 8,   // after failure 3: 240000
            300_000,      // after failure 4 (would be 480000, capped)
            300_000,      // after failure 5 (cap)
            300_000,      // after failure 6 (cap)
        ];

        for (const expected of expectedIntervals) {
            const prevCallCount = setTimeoutSpy.mock.calls.length;
            await vi.advanceTimersByTimeAsync(setTimeoutSpy.mock.calls[prevCallCount - 1][1] as number);
            const newCallCount = setTimeoutSpy.mock.calls.length;
            expect(newCallCount).toBeGreaterThan(prevCallCount);
            expect(setTimeoutSpy.mock.calls[newCallCount - 1][1]).toBe(expected);
        }

        // Now trigger the success poll — interval should halve each time toward base.
        // After failure 6, consecutiveFailures=6, currentIntervalMs=300000.
        // On success: consecutiveFailures=5, currentIntervalMs=150000.
        const prevCallCount = setTimeoutSpy.mock.calls.length;
        await vi.advanceTimersByTimeAsync(setTimeoutSpy.mock.calls[prevCallCount - 1][1] as number);
        const afterSuccessCallCount = setTimeoutSpy.mock.calls.length;
        expect(afterSuccessCallCount).toBeGreaterThan(prevCallCount);
        // The interval after one success should be halved (300000 / 2 = 150000).
        expect(setTimeoutSpy.mock.calls[afterSuccessCallCount - 1][1]).toBe(150_000);
    });

    it("polling error handling: replicate rejection is caught and console.error is called", async () => {
        const core = createCoreMock();
        vi.mocked(offlineScanner.performFullScan).mockResolvedValue(true);
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        // Make replicate succeed on the initial call (startup), then fail on the poll.
        let callCount = 0;
        core.services.replication.replicate = vi.fn(async () => {
            callCount++;
            if (callCount === 1) return true; // startup replicate
            throw new Error("network failure");
        });

        const intervalMs = 30 * 1000;
        await runCommand(makeDaemonOptions(30), { ...baseContext, core });

        // Advance time to trigger the first poll callback and flush its async work.
        await vi.advanceTimersByTimeAsync(intervalMs);

        // No unhandled rejection — the error was caught internally.
        const errorCalls = consoleSpy.mock.calls.filter(
            (args) => typeof args[0] === "string" && args[0].includes("Poll error")
        );
        expect(errorCalls.length).toBeGreaterThan(0);
    });
});
