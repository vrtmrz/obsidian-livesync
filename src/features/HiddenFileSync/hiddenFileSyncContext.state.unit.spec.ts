import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({}));
vi.mock("./configureHiddenFileSyncMode.ts", () => ({
    configureHiddenFileSyncMode: vi.fn(),
}));

import { HiddenFileSyncContext } from "./hiddenFileSyncContext.ts";

function createContext() {
    const periodicProcessor = { enable: vi.fn(), disable: vi.fn() };
    const publishActivity = vi.fn();
    const hideConfigurationChangeNotice = vi.fn();
    const context = new HiddenFileSyncContext({
        createPeriodicProcessor: vi.fn(() => periodicProcessor),
        publishActivity,
        closeJsonConflictDialogs: vi.fn(),
        hideConfigurationChangeNotice,
    } as never);
    return { context, hideConfigurationChangeNotice, periodicProcessor, publishActivity };
}

describe("HiddenFileSyncContext state ownership", () => {
    it("owns queues, caches, concurrency controls, and processors per context instance", () => {
        const first = createContext();
        const second = createContext();

        first.context.pendingConflictChecks.add("i:.obsidian/first.json" as never);
        first.context.queuedNotificationFiles.add(".obsidian/plugins/first");
        first.context.cacheFileRegExps.set("first", []);

        expect(second.context.pendingConflictChecks).toEqual(new Set());
        expect(second.context.queuedNotificationFiles).toEqual(new Set());
        expect(second.context.cacheFileRegExps).toEqual(new Map());
        expect(first.context.conflictResolutionProcessor).not.toBe(second.context.conflictResolutionProcessor);
        expect(first.context.semaphore).not.toBe(second.context.semaphore);
        expect(first.context.periodicInternalFileScanProcessor).toBe(first.periodicProcessor);
        expect(second.context.periodicInternalFileScanProcessor).toBe(second.periodicProcessor);

        first.context.dispose();
        second.context.dispose();
    });

    it("publishes instance-owned event and processing counts at each transition", async () => {
        const { context, publishActivity } = createContext();
        const path = ".obsidian/app.json" as FilePath;

        await context.serializedForEvent(path, async () => {
            expect(publishActivity).toHaveBeenLastCalledWith(1, 1);
        });

        expect(publishActivity.mock.calls).toEqual([
            [1, 0],
            [1, 1],
            [1, 0],
            [0, 0],
        ]);
        context.dispose();
    });

    it.each([
        [new Map(), true],
        [new Map([[".obsidian/app.json", "1-2-3"]]), false],
    ])(
        "preserves start-up scan notice selection for the processed-file cache",
        async (processedFiles, forcedNotice) => {
            const { context } = createContext();
            const performStartupScan = vi.fn(async () => undefined);
            const keyValueDatabase = {
                get: vi.fn(async (key: IDBValidKey) => {
                    if (key == "hidden-file-lastProcessed") return processedFiles;
                    return new Map();
                }),
            };
            Object.assign(context, {
                dependencies: {
                    createPeriodicProcessor: vi.fn(),
                    getKeyValueDatabase: () => keyValueDatabase,
                    getSettings: () => ({ syncInternalFiles: true }),
                    log: vi.fn(),
                },
                performStartupScan,
            });

            await context._everyOnDatabaseInitialized(false);

            expect(performStartupScan).toHaveBeenCalledWith(forcedNotice);
            context.conflictResolutionProcessor.terminate();
        }
    );
});
