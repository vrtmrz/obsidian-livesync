import { describe, expect, it, vi } from "vitest";
import {
    type FilePathWithPrefix,
    MODE_AUTOMATIC,
    MODE_SELECTIVE,
    type PluginSyncSettingEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";

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

import { CustomisationSyncContext } from "./customisationSyncContext.ts";
import { createCustomisationSyncTestDependencies } from "./customisationSyncContext.unit.fixture.ts";
import type { IPluginDataExDisplay } from "./customisationSyncView.ts";

function createConfigSync() {
    const saveSettingData = vi.fn(async () => undefined);
    const replicateUserInitiated = vi.fn(async () => undefined);
    const askString = vi.fn(async () => "device-b" as string | false);
    const pluginSyncExtendedSetting: Record<string, PluginSyncSettingEntry> = {
        "PLUGIN_DATA/example": {
            key: "PLUGIN_DATA/example",
            mode: MODE_AUTOMATIC,
            files: ["plugins/example/data.json"],
        },
    };
    const settings = {
        usePluginSync: true,
        usePluginSyncV2: true,
        usePluginEtc: true,
        pluginSyncExtendedSetting,
    };
    const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
    Object.assign(configSync, {
        dependencies: createCustomisationSyncTestDependencies({
            getConfigDir: () => ".obsidian",
            getSettings: () => settings as never,
            saveSettingData,
            replicateUserInitiated: replicateUserInitiated as never,
            askString,
        }),
    });
    return { askString, configSync, replicateUserInitiated, saveSettingData, settings };
}

const display = {
    documentPath: "ix:device-a/PLUGIN_DATA/example%data.json" as FilePathWithPrefix,
    category: "PLUGIN_DATA",
    name: "example",
    term: "device-a",
    files: [
        { filename: "data.json", data: ["a"], mtime: 1, size: 1 },
        { filename: "other.json", data: ["b"], mtime: 2, size: 1 },
    ],
    mtime: 2,
} satisfies IPluginDataExDisplay;

describe("CustomisationSyncContext dialogue view", () => {
    it("projects and updates Customisation Sync modes without exposing mutable settings", () => {
        const { configSync, saveSettingData, settings } = createConfigSync();

        const projected = configSync.getConfiguredModes();
        projected[0].files.push("changed-in-view");

        expect(settings.pluginSyncExtendedSetting["PLUGIN_DATA/example"].files).toEqual(["plugins/example/data.json"]);
        expect(configSync.getConfiguredTargetFiles("PLUGIN_DATA/example")).toEqual([
            ".obsidian/plugins/example/data.json",
        ]);

        configSync.updateConfiguredMode("PLUGIN_MAIN/example", MODE_AUTOMATIC, ["plugins/example/main.js"]);
        expect(settings.pluginSyncExtendedSetting["PLUGIN_MAIN/example"]).toEqual({
            key: "PLUGIN_MAIN/example",
            mode: MODE_AUTOMATIC,
            files: ["plugins/example/main.js"],
        });

        configSync.updateConfiguredMode("PLUGIN_MAIN/example", MODE_SELECTIVE, []);
        expect(settings.pluginSyncExtendedSetting).not.toHaveProperty("PLUGIN_MAIN/example");
        expect(saveSettingData).toHaveBeenCalledTimes(2);
    });

    it("routes host operations through the focused view", async () => {
        const { askString, configSync, replicateUserInitiated } = createConfigSync();

        await configSync.synchronise();
        await expect(configSync.askString("Duplicate", "device name", "")).resolves.toBe("device-b");

        expect(replicateUserInitiated).toHaveBeenCalledWith({
            trigger: "manual",
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
        expect(askString).toHaveBeenCalledWith("Duplicate", "device name", "");
    });

    it("keeps file-level comparison clones and duplication inside the view boundary", async () => {
        const { configSync } = createConfigSync();
        const compareUsingDisplayData = vi.fn<
            (dataA: IPluginDataExDisplay, dataB: IPluginDataExDisplay, compareEach?: boolean) => Promise<boolean>
        >(async () => true);
        const storeCustomizationFiles = vi.fn(async () => true);
        const updatePluginList = vi.fn(async () => undefined);
        Object.assign(configSync, {
            compareUsingDisplayData,
            pathOperations: {
                filenameToUnifiedKey: vi.fn(() => "ix:device-b/PLUGIN_DATA/example.md"),
            },
            storeCustomizationFiles,
            updatePluginList,
        });

        await expect(configSync.compareFileUsingDisplayData(display, display, "data.json")).resolves.toBe(true);
        const [left, right, compareEach] = compareUsingDisplayData.mock.calls[0];
        expect(left.files.map((file) => file.filename)).toEqual(["data.json"]);
        expect(right.files.map((file) => file.filename)).toEqual(["data.json"]);
        expect(compareEach).toBe(true);
        expect(display.files).toHaveLength(2);

        await configSync.duplicateData(display, "device-b");
        expect(storeCustomizationFiles).toHaveBeenCalledWith(".obsidian/data.json", "device-b");
        expect(updatePluginList).toHaveBeenCalledWith(false, "ix:device-b/PLUGIN_DATA/example.md");
    });
});
