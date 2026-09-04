import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock("@/deps.ts", () => ({
    diff_match_patch: class DiffMatchPatch {},
    normalizePath: vi.fn((path: string) => path),
    parseYaml: vi.fn(),
    Platform: {},
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
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@/common/obsidianCommunityPlugins.ts", () => ({
    getObsidianCommunityPluginManager: vi.fn(),
}));

import { scheduleTask } from "@/common/utils.ts";
import { CustomisationSyncContext } from "./customisationSyncContext.ts";
import { createCustomisationSyncTestDependencies } from "./customisationSyncContext.unit.fixture.ts";
import { CustomisationSyncRecentEventDeduplicator } from "./customisationSyncRecentEventDeduplicator.ts";

const PATH = ".obsidian/plugins/example/data.json" as FilePath;

function createConfigSync(options: { ready?: boolean; suspended?: boolean; enabled?: boolean; owned?: boolean } = {}) {
    const settings = {
        usePluginSync: true,
        usePluginSyncV2: true,
        usePluginEtc: true,
        pluginSyncExtendedSetting: {},
    };
    const ownsLocalFile = vi.fn(() => options.owned ?? true);
    const statHidden = vi.fn(async () => ({ type: "file", mtime: 1 }));
    const recentProcessedInternalFiles = new CustomisationSyncRecentEventDeduplicator();
    const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
    Object.assign(configSync, {
        dependencies: createCustomisationSyncTestDependencies({
            getConfigDir: () => ".obsidian",
            getSettings: () => settings as never,
            storageAccess: { statHidden } as never,
            ownsLocalFile,
        }),
        _isMainReady: vi.fn(() => options.ready ?? true),
        _isMainSuspended: vi.fn(() => options.suspended ?? false),
        isThisModuleEnabled: vi.fn(() => options.enabled ?? true),
        pathOperations: {
            isTargetPath: vi.fn((path: FilePath) => path == PATH),
            filenameToUnifiedKey: vi.fn(() => "ix:device-a/PLUGIN_DATA/example.md"),
        },
        recentProcessedInternalFiles,
        _log: vi.fn(),
    });
    return { configSync, ownsLocalFile, statHidden };
}

describe("Customisation Sync raw-event admission", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("schedules a recognised path granted by the composition owner", async () => {
        const { configSync, ownsLocalFile } = createConfigSync();

        await expect(configSync.serviceHandlers.processOptionalFileEvent(PATH)).resolves.toBe(true);
        expect(ownsLocalFile).toHaveBeenCalledWith(PATH);
        expect(scheduleTask).toHaveBeenCalledOnce();
    });

    it("rejects an event while the host is not ready", async () => {
        const { configSync, statHidden } = createConfigSync({ ready: false });

        await expect(configSync.serviceHandlers.processOptionalFileEvent(PATH)).resolves.toBe(false);
        expect(statHidden).not.toHaveBeenCalled();
        expect(scheduleTask).not.toHaveBeenCalled();
    });

    it("rejects a path outside the recognised Customisation Sync categories", async () => {
        const { configSync, ownsLocalFile } = createConfigSync();

        await expect(configSync.serviceHandlers.processOptionalFileEvent(".obsidian/workspace" as FilePath)).resolves.toBe(
            false
        );
        expect(ownsLocalFile).not.toHaveBeenCalled();
        expect(scheduleTask).not.toHaveBeenCalled();
    });

    it("rejects a recognised path assigned to another owner", async () => {
        const { configSync, statHidden } = createConfigSync({ owned: false });

        await expect(configSync.serviceHandlers.processOptionalFileEvent(PATH)).resolves.toBe(false);
        expect(statHidden).not.toHaveBeenCalled();
        expect(scheduleTask).not.toHaveBeenCalled();
    });

    it.each([
        ["suspended", { suspended: true }],
        ["disabled", { enabled: false }],
    ] as const)("rejects an event while %s", async (_label, options) => {
        const { configSync } = createConfigSync(options);

        await expect(configSync.serviceHandlers.processOptionalFileEvent(PATH)).resolves.toBe(false);
        expect(scheduleTask).not.toHaveBeenCalled();
    });
});
