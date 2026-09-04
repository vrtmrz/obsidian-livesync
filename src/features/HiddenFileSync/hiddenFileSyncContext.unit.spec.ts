import { describe, expect, it, vi } from "vitest";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSyncContext } from "./hiddenFileSyncContext.ts";
import { configureHiddenFileSyncMode } from "./configureHiddenFileSyncMode.ts";

function callPrivate<T extends (...args: never[]) => unknown>(context: HiddenFileSyncContext, key: string): T {
    const operation = (context as unknown as Record<string, T>)[key];
    return operation.bind(context) as T;
}

describe("HiddenFileSyncContext lifecycle", () => {
    it("releases its processors, capability owners, and host conflict dialogues", () => {
        const periodicInternalFileScanProcessor = { disable: vi.fn() };
        const conflictResolution = { dispose: vi.fn() };
        const changeProcessor = { dispose: vi.fn() };
        const pathAdmission = { dispose: vi.fn() };
        const changeNotifier = { dispose: vi.fn() };
        const closeJsonConflictDialogs = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: { closeJsonConflictDialogs },
            periodicInternalFileScanProcessor,
            conflictResolution,
            changeProcessor,
            pathAdmission,
            changeNotifier,
            eventCount: 4,
            processingCount: 2,
        });

        hiddenFileSync.dispose();
        hiddenFileSync.dispose();

        expect(periodicInternalFileScanProcessor.disable).toHaveBeenCalledOnce();
        expect(conflictResolution.dispose).toHaveBeenCalledOnce();
        expect(changeProcessor.dispose).toHaveBeenCalledOnce();
        expect(pathAdmission.dispose).toHaveBeenCalledOnce();
        expect(changeNotifier.dispose).toHaveBeenCalledOnce();
        expect(closeJsonConflictDialogs).toHaveBeenCalledOnce();
    });

    it("does not report Hidden File Sync as ready before the main runtime is ready", () => {
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: {
                getSettings: () => ({
                    syncInternalFiles: true,
                }),
            },
            _isMainReady: vi.fn(() => false),
            _isMainSuspended: vi.fn(() => false),
        });

        expect(callPrivate<() => boolean>(hiddenFileSync, "isReady")()).toBe(false);
    });

    it("keeps subordinate initialisation phases below Notice level so one progress Notice owns the scan", async () => {
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const rebuildMerging = vi.fn(async () => []);
        const adoptCurrentStorageFilesAsProcessed = vi.fn(async () => undefined);
        const adoptCurrentDatabaseFilesAsProcessed = vi.fn(async () => undefined);
        const scanAllStorageChanges = vi.fn(async () => undefined);
        const scanAllDatabaseChanges = vi.fn(async () => undefined);
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            _progress: vi.fn(() => progress),
            rebuildMerging,
            adoptCurrentStorageFilesAsProcessed,
            adoptCurrentDatabaseFilesAsProcessed,
            scanAllStorageChanges,
            scanAllDatabaseChanges,
        });

        await hiddenFileSync.initialiseInternalFileSync("safe", true);

        expect(rebuildMerging).toHaveBeenCalledWith(false, false);
        expect(scanAllStorageChanges).toHaveBeenCalledWith(false, true, false);
        expect(scanAllDatabaseChanges).toHaveBeenCalledWith(false, true, false);
        expect(progress.done).toHaveBeenCalledOnce();
    });

    it("retirement guard: does not restore separate gathering and restart Notices", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            await handlers.initialise("safe");
            return "enabled";
        });
        const events: string[] = [];
        const progress = {
            log: vi.fn((message: string) => {
                events.push(`progress:${message}`);
            }),
            once: vi.fn(),
            done: vi.fn(),
        };
        const createProgress = vi.fn(() => progress);
        const applyPartial = vi.fn(async () => {
            events.push("apply-settings");
        });
        const initialiseInternalFileSync = vi.fn(async () => undefined);
        const log = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: { applySettings: applyPartial },
            initialiseInternalFileSync,
            _progress: createProgress,
            _log: log,
        });

        await callPrivate<(mode: "MERGE") => Promise<void>>(hiddenFileSync, "configureHiddenFileSync")("MERGE");

        expect(createProgress).toHaveBeenCalledWith("[⚙ Initialise]\n", LOG_LEVEL_NOTICE);
        expect(events[0]).toBe("progress:Preparing Hidden File Sync...");
        expect(initialiseInternalFileSync).toHaveBeenCalledWith("safe", true, false, progress);
        expect(log).not.toHaveBeenCalledWith("Gathering files for enabling Hidden File Sync", LOG_LEVEL_NOTICE);
        expect(log).not.toHaveBeenCalledWith("Done! Restarting the app is strongly recommended!", LOG_LEVEL_NOTICE);
        expect(log).toHaveBeenCalledWith("Hidden File Sync initialisation completed.", expect.any(Number));
    });

    it("closes the preparation Notice when enabling Hidden File Sync fails", async () => {
        vi.mocked(configureHiddenFileSyncMode).mockImplementation(async (_mode, handlers) => {
            await handlers.enable();
            return "enabled";
        });
        const error = new Error("setting persistence failed");
        const progress = {
            log: vi.fn(),
            once: vi.fn(),
            done: vi.fn(),
        };
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: {
                applySettings: vi.fn(async () => {
                    throw error;
                }),
            },
            _progress: vi.fn(() => progress),
            _log: vi.fn(),
        });

        await expect(
            callPrivate<(mode: "MERGE") => Promise<void>>(hiddenFileSync, "configureHiddenFileSync")("MERGE")
        ).rejects.toBe(error);

        expect(progress.done).toHaveBeenCalledWith("Failed");
    });
});
