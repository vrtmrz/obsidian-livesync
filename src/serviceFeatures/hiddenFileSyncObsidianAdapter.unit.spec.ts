import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    hiddenFilesEventCount,
    hiddenFilesProcessingCount,
} from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";

const mocks = vi.hoisted(() => ({
    log: vi.fn(),
    sendSignal: vi.fn(),
    getFileRegExp: vi.fn(() => []),
    openModal: vi.fn(),
    modal: {
        resolve: undefined as ((keepRevision?: string, mergedText?: string) => Promise<void>) | undefined,
    },
    pluginManager: {
        manifests: [
            { id: "alpha", name: "Alpha", dir: ".obsidian/plugins/alpha" },
            { id: "beta", name: "Beta", dir: ".obsidian/plugins/beta" },
        ],
        enabledPlugins: new Set(["alpha", "beta"]),
        unloadPlugin: vi.fn(async () => undefined),
        loadPlugin: vi.fn(async () => undefined),
    },
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/common/utils", () => ({
    fireAndForget: (operation: () => Promise<unknown>) => void operation(),
    getFileRegExp: mocks.getFileRegExp,
    sendSignal: mocks.sendSignal,
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/services/lib/logUtils", () => ({
    createInstanceLogFunction: () => mocks.log,
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {},
}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {
        constructor(
            _app: unknown,
            _path: unknown,
            _docs: unknown,
            callback: (keepRevision?: string, mergedText?: string) => Promise<void>
        ) {
            mocks.modal.resolve = callback;
        }
        open() {
            mocks.openModal();
        }
    },
}));
vi.mock("@/modules/features/ModuleLog.ts", () => ({ MARK_DONE: "<done>" }));

vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: () => mocks.pluginManager,
}));

import { createHiddenFileSyncObsidianDependencies } from "./hiddenFileSyncObsidianAdapter.ts";

function createFixture() {
    const noticeGroups = {
        setItem: vi.fn(),
        finish: vi.fn(() => true),
        removeItem: vi.fn(() => true),
        hide: vi.fn(() => true),
    };
    const scheduleRestart = vi.fn();
    const settings = {
        syncInternalFiles: true,
        syncInternalFileOverwritePatterns: "",
        syncInternalFilesIgnorePatterns: "",
        syncInternalFilesTargetPatterns: "",
    };
    const app = {
        vault: {
            getRoot: vi.fn(() => ({ path: "" })),
            adapter: { list: vi.fn(async () => ({ files: [], folders: [] })) },
        },
    };
    const host = {
        services: {
            context: { app, noticeGroups },
            API: { getSystemConfigDir: vi.fn(() => ".obsidian") },
            appLifecycle: {
                isReady: vi.fn(() => true),
                isSuspended: vi.fn(() => false),
                isReloadingScheduled: vi.fn(() => false),
                scheduleRestart,
            },
            database: { localDatabase: {}, isDatabaseReady: vi.fn(() => true) },
            keyValueDB: { kvDB: {} },
            path: {},
            setting: { settings, applyPartial: vi.fn(async () => undefined) },
            vault: { isIgnoredByIgnoreFile: vi.fn(async () => false) },
        },
        serviceModules: {
            storageAccess: {},
            databaseFileAccess: {},
        },
    };
    const ownsLocalFile = vi.fn(() => true);
    const dependencies = createHiddenFileSyncObsidianDependencies(host as never, { ownsLocalFile });
    return { dependencies, noticeGroups, scheduleRestart, settings };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.modal.resolve = undefined;
    hiddenFilesEventCount.value = 0;
    hiddenFilesProcessingCount.value = 0;
});

describe("Hidden File Sync Obsidian adapter", () => {
    it("owns grouped plug-in reload and application restart Notices", async () => {
        const { dependencies, noticeGroups, scheduleRestart } = createFixture();

        dependencies.showConfigurationChangeNotice([".obsidian/plugins/alpha", ".obsidian/plugins/beta", ".obsidian"]);

        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(1, "hidden-file-changes", "plugin:alpha", {
            message: "Files in Alpha were updated.",
            action: expect.objectContaining({ label: "Reload Alpha" }),
        });
        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(2, "hidden-file-changes", "plugin:beta", {
            message: "Files in Beta were updated.",
            action: expect.objectContaining({ label: "Reload Beta" }),
        });
        expect(noticeGroups.setItem).toHaveBeenNthCalledWith(3, "hidden-file-changes", "restart", {
            message: "Other Obsidian settings files were updated.",
            action: expect.objectContaining({ label: "Schedule an Obsidian restart" }),
        });
        expect(noticeGroups.finish).toHaveBeenCalledWith("hidden-file-changes", { durationMs: 20_000 });

        const reload = (noticeGroups.setItem.mock.calls[0]?.[2] as { action: { onSelect(): void } }).action.onSelect;
        reload();
        await vi.waitFor(() => {
            expect(mocks.pluginManager.unloadPlugin).toHaveBeenCalledWith("alpha");
            expect(mocks.pluginManager.loadPlugin).toHaveBeenCalledWith("alpha");
            expect(noticeGroups.removeItem).toHaveBeenCalledWith("hidden-file-changes", "plugin:alpha");
        });

        const restart = (noticeGroups.setItem.mock.calls[2]?.[2] as { action: { onSelect(): void } }).action.onSelect;
        restart();
        expect(scheduleRestart).toHaveBeenCalledOnce();
        expect(noticeGroups.removeItem).toHaveBeenCalledWith("hidden-file-changes", "restart");

        dependencies.hideConfigurationChangeNotice();
        expect(noticeGroups.hide).toHaveBeenCalledWith("hidden-file-changes");
    });

    it("owns the conflict dialogue, progress presentation, and compatibility activity publication", async () => {
        const { dependencies } = createFixture();
        const docs = [{ path: "i:.obsidian/app.json" }, { path: "i:.obsidian/app.json" }] as never;
        const apply = vi.fn(async () => true);

        const resolution = dependencies.resolveJsonConflict(".obsidian/app.json" as never, docs, apply);
        expect(mocks.sendSignal).toHaveBeenCalledWith("cancel-internal-conflict:.obsidian/app.json");
        expect(mocks.openModal).toHaveBeenCalledOnce();
        await mocks.modal.resolve?.("2-selected", "merged");
        await expect(resolution).resolves.toBe(true);
        expect(apply).toHaveBeenCalledWith({ keepRevision: "2-selected", mergedText: "merged" });

        const progress = dependencies.createProgress("Prefix: ", LOG_LEVEL_NOTICE);
        progress.log("Working");
        progress.once("Once");
        progress.done();
        expect(mocks.log).toHaveBeenNthCalledWith(1, "Prefix: Working", LOG_LEVEL_NOTICE, "keepalive-progress-0");
        expect(mocks.log).toHaveBeenNthCalledWith(2, "Prefix: Once", LOG_LEVEL_NOTICE);
        expect(mocks.log).toHaveBeenNthCalledWith(3, "Prefix: Done<done>", LOG_LEVEL_NOTICE, "keepalive-progress-0");

        dependencies.publishActivity(3, 1);
        expect(hiddenFilesEventCount.value).toBe(3);
        expect(hiddenFilesProcessingCount.value).toBe(1);
    });

    it("closes each active conflict dialogue with the path used by the modal", async () => {
        const { dependencies } = createFixture();
        const docs = [{ path: "i:.obsidian/app.json" }, { path: "i:.obsidian/app.json" }] as never;
        const apply = vi.fn(async () => false);

        const resolution = dependencies.resolveJsonConflict(".obsidian/app.json" as never, docs, apply);
        dependencies.closeJsonConflictDialogs();

        expect(mocks.sendSignal).toHaveBeenNthCalledWith(1, "cancel-internal-conflict:.obsidian/app.json");
        expect(mocks.sendSignal).toHaveBeenNthCalledWith(2, "cancel-internal-conflict:.obsidian/app.json");

        await mocks.modal.resolve?.();
        await expect(resolution).resolves.toBe(false);
        expect(apply).toHaveBeenCalledWith({ keepRevision: undefined, mergedText: undefined });
    });
});
