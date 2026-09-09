import { describe, expect, it } from "vitest";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

import {
    createCustomisationSyncDevicePrefix,
    createCustomisationSyncV1DocumentPath,
    createCustomisationSyncV2DocumentPath,
    getCustomisationSyncCategoryFolder,
    getCustomisationSyncFileCategory,
    isCustomisationSyncTargetPath,
    getCustomisationSyncSettingKey,
    getCustomisationSyncSettingKeyFromDocumentPath,
    parseCustomisationSyncV2DocumentPath,
    type CustomisationSyncPathOptions,
} from "./customisationSyncPaths.ts";

const currentOptions: CustomisationSyncPathOptions = {
    configDir: ".obsidian",
    useV2: true,
    usePluginEtc: true,
};

describe("compatibility: Customisation Sync path operations", () => {
    it.each([
        ["CONFIG", ".obsidian/"],
        ["THEME", ".obsidian/themes/"],
        ["SNIPPET", ".obsidian/snippets/"],
        ["PLUGIN_MAIN", ".obsidian/plugins/"],
        ["PLUGIN_DATA", ".obsidian/plugins/"],
        ["PLUGIN_ETC", ".obsidian/plugins/"],
        ["UNKNOWN", ""],
    ])("maps category %s to folder %s", (category, expected) => {
        expect(getCustomisationSyncCategoryFolder(category, ".obsidian")).toBe(expected);
    });

    it.each([
        [".obsidian/app.json", "CONFIG"],
        [".obsidian/themes/Minimal/theme.css", "THEME"],
        [".obsidian/snippets/example.css", "SNIPPET"],
        [".obsidian/plugins/example/manifest.json", "PLUGIN_MAIN"],
        [".obsidian/plugins/example/data.json", "PLUGIN_DATA"],
        [".obsidian/plugins/example/extra.json", "PLUGIN_ETC"],
    ] as const)("classifies the maintained path %s as %s", (path, expected) => {
        expect(getCustomisationSyncFileCategory(path, currentOptions)).toBe(expected);
    });

    it("preserves the exact depth and case-sensitive category rules", () => {
        expect(getCustomisationSyncFileCategory(".obsidian/themes/Minimal/assets/theme.css", currentOptions)).toBe("");
        expect(getCustomisationSyncFileCategory(".obsidian/snippets/example.CSS", currentOptions)).toBe("");
        expect(getCustomisationSyncFileCategory(".Obsidian/plugins/example/main.js", currentOptions)).toBe("");
    });

    it("requires both V2 and plug-in-extra support for other plug-in files", () => {
        const path = ".obsidian/plugins/example/extra.json";

        expect(getCustomisationSyncFileCategory(path, { ...currentOptions, useV2: false })).toBe("");
        expect(getCustomisationSyncFileCategory(path, { ...currentOptions, usePluginEtc: false })).toBe("");
    });

    it("keeps category classification separate from configuration-directory targeting", () => {
        expect(getCustomisationSyncFileCategory("notes/example.json", currentOptions)).toBe("CONFIG");
        expect(isCustomisationSyncTargetPath("notes/example.json", currentOptions)).toBe(false);
        expect(isCustomisationSyncTargetPath(".obsidian/app.json", currentOptions)).toBe(true);
    });

    it.each([
        [".obsidian/app.json", "CONFIG/app.json"],
        [".obsidian/themes/Minimal/theme.css", "THEME/Minimal"],
        [".obsidian/snippets/example.css", "SNIPPET/example.css"],
        [".obsidian/plugins/example/main.js", "PLUGIN_MAIN/example"],
        [".obsidian/plugins/example/data.json", "PLUGIN_DATA/example"],
        [".obsidian/plugins/example/extra.json", "PLUGIN_ETC/example"],
    ] as const)("maps the local path %s to setting key %s", (path, expected) => {
        expect(getCustomisationSyncSettingKey(path, currentOptions)).toBe(expected);
    });

    it.each([
        ["ix:device-a/CONFIG/app.json.md", "CONFIG/app.json"],
        ["ix:device-a/CONFIG/app.json%app.json", "CONFIG/app.json"],
        ["ix:device-a/THEME/Minimal.md", "THEME/Minimal"],
        ["ix:device-a/PLUGIN_DATA/example%data.json", "PLUGIN_DATA/example"],
        ["ix:device-a/PLUGIN_ETC/example/extra.json.md", "PLUGIN_ETC/example"],
    ] as const)("maps the persisted path %s to setting key %s", (path, expected) => {
        expect(getCustomisationSyncSettingKeyFromDocumentPath(path as FilePathWithPrefix)).toBe(expected);
    });

    it.each([
        [".obsidian/app.json", "ix:device-a/CONFIG/app.json.md"],
        [".obsidian/themes/Minimal/theme.css", "ix:device-a/THEME/Minimal.md"],
        [".obsidian/plugins/example/main.js", "ix:device-a/PLUGIN_MAIN/example.md"],
        [".obsidian/plugins/example/extra.json", "ix:device-a/PLUGIN_ETC/example/extra.json.md"],
    ] as const)("creates the persisted V1 path for %s", (path, expected) => {
        expect(createCustomisationSyncV1DocumentPath(path, "device-a", currentOptions)).toBe(expected);
    });

    it.each([
        [".obsidian/app.json", "ix:device-a/CONFIG/app.json%app.json"],
        [".obsidian/themes/Minimal/theme.css", "ix:device-a/THEME/Minimal%theme.css"],
        [".obsidian/plugins/example/main.js", "ix:device-a/PLUGIN_MAIN/example%main.js"],
        [".obsidian/plugins/example/extra.json", "ix:device-a/PLUGIN_ETC/example%extra.json"],
    ] as const)("creates the persisted V2 path for %s", (path, expected) => {
        expect(createCustomisationSyncV2DocumentPath(path, "device-a", currentOptions)).toBe(expected);
    });

    it("creates and parses device-scoped V2 paths", () => {
        expect(createCustomisationSyncDevicePrefix("device-a")).toBe("ix:device-a/");
        expect(
            parseCustomisationSyncV2DocumentPath("ix:device-a/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix)
        ).toEqual({
            device: "device-a",
            category: "PLUGIN_MAIN",
            key: "example",
            filename: "main.js",
            pathV1: "ix:device-a/PLUGIN_MAIN/example.md",
        });
    });
});
