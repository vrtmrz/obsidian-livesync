import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/deps.ts", () => ({
    addIcon: vi.fn(),
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
}));
vi.mock("./PluginDialogModal.ts", () => ({
    PluginDialogModal: class PluginDialogModal {},
}));
vi.mock("@/features/HiddenFileCommon/JsonResolveModal.ts", () => ({
    JsonResolveModal: class JsonResolveModal {},
}));
vi.mock("@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts", () => ({
    ConflictResolveModal: class ConflictResolveModal {},
}));
// The readiness helpers come from the real LiveSyncCommands, so only its log view dependency is replaced.
vi.mock("@/modules/features/ModuleLog.ts", () => ({
    MARK_DONE: "",
}));
vi.mock("@/common/types.ts", () => ({
    ICXHeader: "ix:",
    PERIODIC_PLUGIN_SWEEP: 60,
}));
vi.mock("@/common/utils.ts", () => ({
    cancelTask: vi.fn(),
    EVEN: Symbol("even"),
    isCustomisationSyncMetadata: vi.fn(),
    isPluginMetadata: vi.fn(),
    scheduleTask: vi.fn(),
}));
vi.mock("@/common/PeriodicProcessor.ts", () => ({
    PeriodicProcessor: class PeriodicProcessor {},
}));
vi.mock("@/common/events.ts", () => ({
    EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG: "open-plugin-sync",
    eventHub: {
        onEvent: vi.fn(),
    },
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

import { scheduleTask } from "@/common/utils.ts";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { ConfigSync } from "./CmdConfigSync";

type LifecycleState = {
    ready: boolean;
    suspended: boolean;
};

const CONFIG_FILE = ".obsidian/snippets/theme.css" as FilePath;

function setup(state: LifecycleState) {
    const appLifecycle = {
        isReady: vi.fn(() => state.ready),
        isSuspended: vi.fn(() => state.suspended),
    };
    const statHidden = vi.fn(async () => ({ type: "file", ctime: 0, mtime: 1_000, size: 1 }));
    const storeCustomizationFiles = vi.fn(async () => undefined);
    // Obsidian adds Array.prototype.contains, which is not available under Node.
    const recentProcessedInternalFiles = Object.assign([] as string[], {
        contains: (key: string) => recentProcessedInternalFiles.includes(key),
    });
    const configSync = Object.create(ConfigSync.prototype) as ConfigSync;
    Object.assign(configSync, {
        core: {
            settings: {
                usePluginSync: true,
                pluginSyncExtendedSetting: {},
            },
            services: {
                appLifecycle,
                API: { getSystemConfigDir: () => ".obsidian" },
            },
            storageAccess: { statHidden },
        },
        recentProcessedInternalFiles,
        storeCustomizationFiles,
        filenameToUnifiedKey: (path: string) => `ix:${path}`,
    });
    return {
        appLifecycle,
        configSync,
        statHidden,
    };
}

describe("ConfigSync readiness", () => {
    beforeEach(() => {
        vi.mocked(scheduleTask).mockClear();
    });

    it("leaves a configuration file event unhandled before the plug-in is ready", async () => {
        const { appLifecycle, configSync, statHidden } = setup({ ready: false, suspended: false });

        const handled = await configSync.watchVaultRawEventsAsync(CONFIG_FILE);

        expect(scheduleTask).not.toHaveBeenCalled();
        expect(statHidden).not.toHaveBeenCalled();
        expect(handled).toBe(false);
        expect(appLifecycle.isReady).toHaveBeenCalled();
    });

    it("schedules a configuration file event for storing once the plug-in is ready", async () => {
        const { configSync, statHidden } = setup({ ready: true, suspended: false });

        await expect(configSync.watchVaultRawEventsAsync(CONFIG_FILE)).resolves.toBe(true);

        expect(statHidden).toHaveBeenCalledWith(CONFIG_FILE);
        expect(scheduleTask).toHaveBeenCalledOnce();
        expect(scheduleTask).toHaveBeenCalledWith(`ix:${CONFIG_FILE}`, 100, expect.any(Function));
    });
});
