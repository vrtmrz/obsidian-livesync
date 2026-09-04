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

describe("HiddenFileSyncContext configuration-change notices", () => {
    it("releases processors, transient queues, the pattern cache, activity, and the host Notice effect", () => {
        const periodicInternalFileScanProcessor = { disable: vi.fn() };
        const conflictResolution = { dispose: vi.fn() };
        const queuedNotificationFiles = new Set([".obsidian/plugins/example"]);
        const cacheFileRegExps = new Map([["patterns", []]]);
        const publishActivity = vi.fn();
        const changeProcessor = { dispose: vi.fn() };
        const hideConfigurationChangeNotice = vi.fn();
        const closeJsonConflictDialogs = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: { publishActivity, hideConfigurationChangeNotice, closeJsonConflictDialogs },
            periodicInternalFileScanProcessor,
            conflictResolution,
            changeProcessor,
            queuedNotificationFiles,
            cacheFileRegExps,
            eventCount: 4,
            processingCount: 2,
        });

        hiddenFileSync.dispose();
        hiddenFileSync.dispose();

        expect(periodicInternalFileScanProcessor.disable).toHaveBeenCalledOnce();
        expect(conflictResolution.dispose).toHaveBeenCalledOnce();
        expect(queuedNotificationFiles.size).toBe(0);
        expect(cacheFileRegExps.size).toBe(0);
        expect(changeProcessor.dispose).toHaveBeenCalledOnce();
        expect(closeJsonConflictDialogs).toHaveBeenCalledOnce();
        expect(hideConfigurationChangeNotice).toHaveBeenCalledOnce();
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

    it("settles one batch of changed folders through the host notification effect", () => {
        const showConfigurationChangeNotice = vi.fn();
        const hiddenFileSync = Object.create(HiddenFileSyncContext.prototype) as HiddenFileSyncContext;
        Object.assign(hiddenFileSync, {
            dependencies: { showConfigurationChangeNotice },
            queuedNotificationFiles: new Set([".obsidian/plugins/alpha", ".obsidian/plugins/beta", ".obsidian"]),
        });

        callPrivate<() => void>(hiddenFileSync, "notifyConfigChange")();

        expect(showConfigurationChangeNotice).toHaveBeenCalledWith([
            ".obsidian/plugins/alpha",
            ".obsidian/plugins/beta",
            ".obsidian",
        ]);
        expect((hiddenFileSync as unknown as { queuedNotificationFiles: Set<string> }).queuedNotificationFiles.size).toBe(
            0
        );
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
