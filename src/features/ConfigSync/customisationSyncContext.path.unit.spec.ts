import { describe, expect, it, vi } from "vitest";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

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

function createConfigSync(options: { useV2?: boolean; usePluginEtc?: boolean } = {}) {
    const configSync = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
    Object.assign(configSync, {
        dependencies: createCustomisationSyncTestDependencies({
            getConfigDir: () => ".obsidian",
            getSettings: () => ({
                usePluginSync: true,
                usePluginSyncV2: options.useV2 ?? true,
                usePluginEtc: options.usePluginEtc ?? true,
                pluginSyncExtendedSetting: {},
                autoSweepPlugins: false,
                autoSweepPluginsPeriodic: false,
                watchInternalFileChanges: false,
                notifyPluginOrSettingUpdated: false,
            }),
        }),
    });
    return configSync;
}

describe("compatibility: Customisation Sync paths", () => {
    it.each([
        [".obsidian/app.json", "CONFIG"],
        [".obsidian/themes/minimal/manifest.json", "THEME"],
        [".obsidian/themes/minimal/theme.css", "THEME"],
        [".obsidian/snippets/example.css", "SNIPPET"],
        [".obsidian/plugins/example/manifest.json", "PLUGIN_MAIN"],
        [".obsidian/plugins/example/main.js", "PLUGIN_MAIN"],
        [".obsidian/plugins/example/styles.css", "PLUGIN_MAIN"],
        [".obsidian/plugins/example/data.json", "PLUGIN_DATA"],
        [".obsidian/plugins/example/other.json", "PLUGIN_ETC"],
        [".obsidian/workspace", ""],
        ["notes/example.json", "CONFIG"],
    ])("classifies %s as %s", (path, expected) => {
        expect(createConfigSync().getFileCategory(path)).toBe(expected);
    });

    it("keeps other plug-in files outside V1 and disabled plug-in-extra synchronisation", () => {
        const v1 = createConfigSync({ useV2: false });
        const withoutPluginEtc = createConfigSync({ usePluginEtc: false });
        const path = ".obsidian/plugins/example/other.json";

        expect(v1.getFileCategory(path)).toBe("");
        expect(withoutPluginEtc.getFileCategory(path)).toBe("");
    });

    it("recognises only classified files below the Obsidian configuration directory", () => {
        const configSync = createConfigSync();

        expect(configSync.isTargetPath(".obsidian/app.json")).toBe(true);
        expect(configSync.isTargetPath(".obsidian/plugins/example/main.js")).toBe(true);
        expect(configSync.isTargetPath(".obsidian/workspace")).toBe(false);
        expect(configSync.isTargetPath("notes/example.json")).toBe(false);
    });

    it.each([
        [".obsidian/app.json", "ix:device-a/CONFIG/app.json.md"],
        [".obsidian/snippets/example.css", "ix:device-a/SNIPPET/example.css.md"],
        [".obsidian/plugins/example/main.js", "ix:device-a/PLUGIN_MAIN/example.md"],
        [".obsidian/plugins/example/data.json", "ix:device-a/PLUGIN_DATA/example.md"],
    ])("creates the V1 document path for %s", (path, expected) => {
        expect(createConfigSync().filenameToUnifiedKey(path)).toBe(expected);
    });

    it.each([
        [".obsidian/app.json", "ix:device-a/CONFIG/app.json%app.json"],
        [".obsidian/snippets/example.css", "ix:device-a/SNIPPET/example.css%example.css"],
        [".obsidian/plugins/example/main.js", "ix:device-a/PLUGIN_MAIN/example%main.js"],
        [".obsidian/plugins/example/data.json", "ix:device-a/PLUGIN_DATA/example%data.json"],
    ])("creates the V2 document path for %s", (path, expected) => {
        expect(createConfigSync().filenameWithUnifiedKey(path)).toBe(expected);
    });

    it("uses an explicit device name when supplied", () => {
        const configSync = createConfigSync();

        expect(configSync.filenameToUnifiedKey(".obsidian/app.json", "device-b")).toBe(
            "ix:device-b/CONFIG/app.json.md"
        );
        expect(configSync.filenameWithUnifiedKey(".obsidian/app.json", "device-b")).toBe(
            "ix:device-b/CONFIG/app.json%app.json"
        );
        expect(configSync.unifiedKeyPrefixOfTerminal("device-b")).toBe("ix:device-b/");
    });

    it("parses a V2 document path and derives its V1 compatibility path", () => {
        expect(
            createConfigSync().parseUnifiedPath("ix:device-a/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix)
        ).toEqual({
            device: "device-a",
            category: "PLUGIN_MAIN",
            key: "example",
            filename: "main.js",
            pathV1: "ix:device-a/PLUGIN_MAIN/example.md",
        });
    });
});
