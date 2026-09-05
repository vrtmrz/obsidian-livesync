import { describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

import {
    createHiddenFileSyncRepairView,
    createHiddenFileSyncServiceHandlerView,
    createHiddenFileSyncTestingView,
    type HiddenFileSyncRepairView,
    type HiddenFileSyncServiceHandlerView,
    type HiddenFileSyncTestingViewOperations,
} from "./hiddenFileSyncViews.ts";

describe("Hidden File Sync repair view", () => {
    it("exposes only frozen repair operations and preserves their receiver", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const file = { path, ctime: 1, mtime: 2, size: 3 };
        const source = {
            marker: "source",
            scanInternalFiles: vi.fn(async function (this: { marker: string }) {
                expect(this.marker).toBe("source");
                return [file];
            }),
            storeInternalFileToDatabase: vi.fn(async function (this: { marker: string }) {
                expect(this.marker).toBe("source");
                return true;
            }),
            storeInternalFileToDatabaseWithBaseRevision: vi.fn(async function (this: { marker: string }) {
                expect(this.marker).toBe("source");
                return true;
            }),
            extractInternalFileRevisionFromDatabase: vi.fn(async function (this: { marker: string }) {
                expect(this.marker).toBe("source");
                return true;
            }),
        } as unknown as HiddenFileSyncRepairView;

        const view = createHiddenFileSyncRepairView(source);

        expect(view).not.toBe(source);
        expect(Object.isFrozen(view)).toBe(true);
        expect(Object.keys(view).sort()).toEqual(
            [
                "extractInternalFileRevisionFromDatabase",
                "scanInternalFiles",
                "storeInternalFileToDatabase",
                "storeInternalFileToDatabaseWithBaseRevision",
            ].sort()
        );
        await expect(view.scanInternalFiles()).resolves.toEqual([file]);
        await expect(view.storeInternalFileToDatabase(file)).resolves.toBe(true);
        await expect(view.storeInternalFileToDatabaseWithBaseRevision(file, "2-selected", false)).resolves.toBe(true);
        await expect(view.extractInternalFileRevisionFromDatabase(path, "2-selected", true)).resolves.toBe(true);
        expect(source.storeInternalFileToDatabaseWithBaseRevision).toHaveBeenCalledWith(file, "2-selected", false);
    });
});

describe("Hidden File Sync service-handler view", () => {
    it("forwards semantic callbacks through a frozen view", async () => {
        const operations = {
            processOptionalFileEvent: vi.fn(async () => true),
            processOptionalSyncFiles: vi.fn(async () => true),
            onSettingLoaded: vi.fn(async () => true),
            realiseSettingSyncMode: vi.fn(async () => true),
            onResuming: vi.fn(async () => true),
            beforeReplicate: vi.fn(async () => true),
            onDatabaseInitialised: vi.fn(async () => true),
            suspendExtraSync: vi.fn(async () => true),
            configureOptionalSyncFeature: vi.fn(async () => true),
            isTargetFileEligible: vi.fn(async () => true),
            queueConflict: vi.fn(async () => true),
        } satisfies HiddenFileSyncServiceHandlerView;

        const view = createHiddenFileSyncServiceHandlerView(operations);

        expect(Object.isFrozen(view)).toBe(true);
        await view.processOptionalFileEvent(".obsidian/app.json" as FilePath);
        await view.processOptionalSyncFiles({} as never);
        await view.onSettingLoaded();
        await view.realiseSettingSyncMode();
        await view.onResuming();
        await view.beforeReplicate(true);
        await view.onDatabaseInitialised(false);
        await view.suspendExtraSync();
        await view.configureOptionalSyncFeature("MERGE");
        await view.isTargetFileEligible(".obsidian/app.json" as FilePath);
        await view.queueConflict("i:.obsidian/app.json" as never);

        expect(operations.processOptionalFileEvent).toHaveBeenCalledWith(".obsidian/app.json");
        expect(operations.beforeReplicate).toHaveBeenCalledWith(true);
        expect(operations.onDatabaseInitialised).toHaveBeenCalledWith(false);
        expect(operations.configureOptionalSyncFeature).toHaveBeenCalledWith("MERGE");
        expect(operations.queueConflict).toHaveBeenCalledWith("i:.obsidian/app.json");
    });
});

describe("Hidden File Sync testing view", () => {
    it("keeps test operations focused while retaining a frozen E2E surface", async () => {
        const conflictResolution = {
            resolveAll: vi.fn(async () => undefined),
            resolveJson: vi.fn(async () => true),
            pendingPaths: [],
            processor: { remaining: 0, totalRemaining: 0, nowProcessing: 0 },
        };
        const restoreRebuild = vi.fn();
        const operations = {
            isManualCommandAvailable: vi.fn(() => true),
            scanAllStorageChanges: vi.fn(async () => undefined),
            scanAllDatabaseChanges: vi.fn(async () => undefined),
            applyOfflineChanges: vi.fn(async () => undefined),
            updateSettingCache: vi.fn(),
            initialiseInternalFileSync: vi.fn(async () => undefined),
            conflictResolution,
            readFileWithInfo: vi.fn(async () => ({}) as never),
            showConfigurationChangeNotice: vi.fn(),
            interceptRebuildMerging: vi.fn(() => restoreRebuild),
        } satisfies HiddenFileSyncTestingViewOperations;

        const view = createHiddenFileSyncTestingView(operations);

        expect(Object.isFrozen(view)).toBe(true);
        await view.scanAllStorageChanges(true);
        await view.readFileWithInfo(".obsidian/app.json" as FilePath);
        view.showConfigurationChangeNotice([".obsidian"]);
        expect(operations.scanAllStorageChanges).toHaveBeenCalledWith(true);
        expect(operations.readFileWithInfo).toHaveBeenCalledWith(".obsidian/app.json");
        expect(operations.showConfigurationChangeNotice).toHaveBeenCalledWith([".obsidian"]);

        const interceptor = vi.fn(async () => [] as FilePath[]);
        expect(view.interceptRebuildMerging(interceptor)).toBe(restoreRebuild);
        expect(operations.interceptRebuildMerging).toHaveBeenCalledWith(interceptor);
    });
});
