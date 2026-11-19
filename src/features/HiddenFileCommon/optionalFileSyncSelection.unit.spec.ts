import { describe, expect, it } from "vitest";
import {
    MODE_AUTOMATIC,
    MODE_PAUSED,
    MODE_SELECTIVE,
    MODE_SHINY,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    categoryToFolder,
    classifyCustomisationFile,
    extractCustomisationItemKeyFromUnifiedPath,
    getHiddenFileSyncPatternExcludedFiles,
    isCaseInsensitiveSelection,
    isCustomisationItemExcludedFromConfigSync,
    pathWithinConfigDirectory,
    selectCustomisationOwner,
} from "./optionalFileSyncSelection";

function makeSettings(
    overrides: Partial<
        Pick<
            ObsidianLiveSyncSettings,
            "usePluginSync" | "usePluginSyncV2" | "usePluginEtc" | "pluginSyncExtendedSetting"
        >
    > = {}
) {
    return {
        usePluginSync: true,
        usePluginSyncV2: true,
        usePluginEtc: false,
        pluginSyncExtendedSetting: {},
        ...overrides,
    };
}

describe("pathWithinConfigDirectory", () => {
    it("extracts relative paths inside the configured directory and rejects siblings and folders", () => {
        expect(pathWithinConfigDirectory(".obsidian/app.json", ".obsidian")).toBe("app.json");
        expect(pathWithinConfigDirectory(".obsidian/plugins/demo/data.json", ".obsidian/")).toBe(
            "plugins/demo/data.json"
        );
        expect(pathWithinConfigDirectory(".obsidian-other/app.json", ".obsidian")).toBeUndefined();
        expect(pathWithinConfigDirectory(".obsidian", ".obsidian")).toBeUndefined();
        expect(pathWithinConfigDirectory(".obsidian/", ".obsidian")).toBeUndefined();
        expect(pathWithinConfigDirectory(".obsidian/plugins/", ".obsidian")).toBeUndefined();
    });

    it("respects the insensitive flag when matching the config directory prefix", () => {
        expect(pathWithinConfigDirectory(".OBSIDIAN/app.json", ".obsidian", false)).toBeUndefined();
        expect(pathWithinConfigDirectory(".OBSIDIAN/app.json", ".obsidian", true)).toBe("app.json");
    });
});

describe("classifyCustomisationFile", () => {
    it("classifies CONFIG, SNIPPET, THEME, PLUGIN_MAIN, PLUGIN_DATA, and PLUGIN_ETC in V2", () => {
        const base = { configDir: ".obsidian", useV2: true, usePluginEtc: false, insensitive: false };
        expect(classifyCustomisationFile(".obsidian/app.json", base)).toEqual({
            category: "CONFIG",
            key: "CONFIG/app.json",
            relativePath: "app.json",
        });
        expect(classifyCustomisationFile(".obsidian/notes.txt", base)).toBeUndefined();
        expect(classifyCustomisationFile(".obsidian/snippets/MyStyle.css", base)).toEqual({
            category: "SNIPPET",
            key: "SNIPPET/MyStyle.css",
            relativePath: "snippets/MyStyle.css",
        });
        expect(classifyCustomisationFile(".obsidian/snippets/notes.txt", base)).toBeUndefined();
        expect(classifyCustomisationFile(".obsidian/snippets/sub/MyStyle.css", base)).toEqual({
            category: "SNIPPET",
            key: "SNIPPET/MyStyle.css",
            relativePath: "snippets/sub/MyStyle.css",
        });
        expect(classifyCustomisationFile(".obsidian/themes/Minimal/theme.css", base)).toEqual({
            category: "THEME",
            key: "THEME/Minimal",
            relativePath: "themes/Minimal/theme.css",
        });
        expect(classifyCustomisationFile(".obsidian/themes/Minimal/extra.json", base)).toEqual({
            category: "THEME",
            key: "THEME/Minimal",
            relativePath: "themes/Minimal/extra.json",
        });
        expect(classifyCustomisationFile(".obsidian/plugins/demo/main.js", base)).toEqual({
            category: "PLUGIN_MAIN",
            key: "PLUGIN_MAIN/demo",
            relativePath: "plugins/demo/main.js",
        });
        expect(classifyCustomisationFile(".obsidian/plugins/demo/data.json", base)).toEqual({
            category: "PLUGIN_DATA",
            key: "PLUGIN_DATA/demo",
            relativePath: "plugins/demo/data.json",
        });
        expect(classifyCustomisationFile(".obsidian/plugins/demo/cache.bin", base)).toBeUndefined();
        expect(classifyCustomisationFile(".obsidian/plugins/demo/cache.bin", { ...base, usePluginEtc: true })).toEqual({
            category: "PLUGIN_ETC",
            key: "PLUGIN_ETC/demo",
            relativePath: "plugins/demo/cache.bin",
        });
        expect(
            classifyCustomisationFile(".obsidian/plugins/demo/sub/cache.bin", { ...base, usePluginEtc: true })
        ).toBeUndefined();
    });

    it("limits V1 THEME members to manifest.json and theme.css and ignores PLUGIN_ETC", () => {
        const v1 = { configDir: ".obsidian", useV2: false, usePluginEtc: true, insensitive: false };
        expect(classifyCustomisationFile(".obsidian/themes/Minimal/manifest.json", v1)?.category).toBe("THEME");
        expect(classifyCustomisationFile(".obsidian/themes/Minimal/theme.css", v1)?.category).toBe("THEME");
        expect(classifyCustomisationFile(".obsidian/themes/Minimal/readme.md", v1)).toBeUndefined();
        expect(classifyCustomisationFile(".obsidian/plugins/demo/cache.bin", v1)).toBeUndefined();
        expect(
            classifyCustomisationFile(".obsidian/plugins/demo/cache.bin", { ...v1, includePluginEtc: true })?.category
        ).toBe("PLUGIN_ETC");
    });

    it("does not misclassify uppercase filenames when insensitive is false", () => {
        const sensitive = { configDir: ".obsidian", useV2: true, usePluginEtc: false, insensitive: false };
        expect(classifyCustomisationFile(".obsidian/APP.JSON", sensitive)).toBeUndefined();
        expect(classifyCustomisationFile(".obsidian/snippets/MYSTYLE.CSS", sensitive)).toBeUndefined();
        expect(classifyCustomisationFile(".obsidian/plugins/demo/DATA.JSON", sensitive)).toBeUndefined();
        expect(classifyCustomisationFile(".obsidian/plugins/demo/MAIN.JS", sensitive)).toBeUndefined();

        const insensitive = { ...sensitive, insensitive: true };
        expect(classifyCustomisationFile(".obsidian/APP.JSON", insensitive)?.category).toBe("CONFIG");
        expect(classifyCustomisationFile(".obsidian/snippets/MYSTYLE.CSS", insensitive)?.category).toBe("SNIPPET");
        expect(classifyCustomisationFile(".obsidian/plugins/demo/DATA.JSON", insensitive)?.category).toBe(
            "PLUGIN_DATA"
        );
        expect(classifyCustomisationFile(".obsidian/plugins/demo/MAIN.JS", insensitive)?.category).toBe("PLUGIN_MAIN");
    });
});

describe("selectCustomisationOwner", () => {
    it("assigns unconfigured Customisation Sync items (default Selective) and Flagged Selective to config", () => {
        const settings = makeSettings({
            pluginSyncExtendedSetting: {
                "SNIPPET/Explicit.css": { key: "SNIPPET/Explicit.css", mode: MODE_SELECTIVE, files: [] },
                "SNIPPET/Flagged.css": { key: "SNIPPET/Flagged.css", mode: MODE_SHINY, files: [] },
            },
        });
        expect(selectCustomisationOwner(".obsidian/app.json", { configDir: ".obsidian", settings })).toBe("config");
        expect(selectCustomisationOwner(".obsidian/snippets/Explicit.css", { configDir: ".obsidian", settings })).toBe(
            "config"
        );
        expect(selectCustomisationOwner(".obsidian/snippets/Flagged.css", { configDir: ".obsidian", settings })).toBe(
            "config"
        );
    });

    it("maps Ignore to ignored and Automatic to hidden even when entry.files is empty", () => {
        const settings = makeSettings({
            pluginSyncExtendedSetting: {
                "CONFIG/workspace.json": { key: "CONFIG/workspace.json", mode: MODE_PAUSED, files: [] },
                "PLUGIN_DATA/demo": { key: "PLUGIN_DATA/demo", mode: MODE_AUTOMATIC, files: [] },
            },
        });
        expect(selectCustomisationOwner(".obsidian/workspace.json", { configDir: ".obsidian", settings })).toBe(
            "ignored"
        );
        expect(selectCustomisationOwner(".obsidian/plugins/demo/data.json", { configDir: ".obsidian", settings })).toBe(
            "hidden"
        );
        expect(selectCustomisationOwner(".obsidian/notes.txt", { configDir: ".obsidian", settings })).toBe("hidden");
    });

    it("hibernates saved modes when Customisation Sync is disabled", () => {
        const settings = makeSettings({
            usePluginSync: false,
            pluginSyncExtendedSetting: {
                "CONFIG/workspace.json": { key: "CONFIG/workspace.json", mode: MODE_PAUSED, files: ["workspace.json"] },
                "SNIPPET/Style.css": { key: "SNIPPET/Style.css", mode: MODE_SELECTIVE, files: ["snippets/Style.css"] },
            },
        });
        expect(selectCustomisationOwner(".obsidian/workspace.json", { configDir: ".obsidian", settings })).toBe(
            "hidden"
        );
        expect(selectCustomisationOwner(".obsidian/snippets/Style.css", { configDir: ".obsidian", settings })).toBe(
            "hidden"
        );
    });

    it("matches saved keys case-insensitively only when insensitive is true", () => {
        const settings = makeSettings({
            pluginSyncExtendedSetting: {
                "SNIPPET/MyStyle.css": { key: "SNIPPET/MyStyle.css", mode: MODE_AUTOMATIC, files: [] },
            },
        });
        expect(
            selectCustomisationOwner(".obsidian/snippets/mystyle.css", {
                configDir: ".obsidian",
                settings,
                insensitive: false,
            })
        ).toBe("config");
        expect(
            selectCustomisationOwner(".obsidian/snippets/mystyle.css", {
                configDir: ".obsidian",
                settings,
                insensitive: true,
            })
        ).toBe("hidden");
    });
});

describe("extractCustomisationItemKeyFromUnifiedPath & helpers", () => {
    it("extracts item keys from both V1 and V2 unified paths", () => {
        expect(
            extractCustomisationItemKeyFromUnifiedPath(
                "ix:dev/CONFIG/workspace.json%workspace.json" as FilePathWithPrefix
            )
        ).toBe("CONFIG/workspace.json");
        expect(
            extractCustomisationItemKeyFromUnifiedPath("ix:dev/CONFIG/workspace.json.md" as FilePathWithPrefix)
        ).toBe("CONFIG/workspace.json");
        expect(
            extractCustomisationItemKeyFromUnifiedPath("ix:dev/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix)
        ).toBe("PLUGIN_MAIN/example");
        expect(extractCustomisationItemKeyFromUnifiedPath("ix:dev/PLUGIN_MAIN/example.md" as FilePathWithPrefix)).toBe(
            "PLUGIN_MAIN/example"
        );
        expect(
            extractCustomisationItemKeyFromUnifiedPath("ix:dev/PLUGIN_ETC/example%cache.json" as FilePathWithPrefix)
        ).toBe("PLUGIN_ETC/example");
        expect(
            extractCustomisationItemKeyFromUnifiedPath("ix:dev/PLUGIN_ETC/example/cache.json.md" as FilePathWithPrefix)
        ).toBe("PLUGIN_ETC/example");
        expect(
            extractCustomisationItemKeyFromUnifiedPath("ix:dev/SNIPPET/100%.css.md" as FilePathWithPrefix)
        ).toBe("SNIPPET/100%.css");
        expect(
            extractCustomisationItemKeyFromUnifiedPath("ix:dev/SNIPPET/100%.css%100%.css" as FilePathWithPrefix)
        ).toBe("SNIPPET/100%.css");
        expect(
            extractCustomisationItemKeyFromUnifiedPath("ix:dev/THEME/Minimal%README.md" as FilePathWithPrefix)
        ).toBe("THEME/Minimal");
        expect(extractCustomisationItemKeyFromUnifiedPath("ix:dev/stale" as FilePathWithPrefix)).toBeUndefined();
    });

    it("checks exclusions, folders, case-sensitivity selection, and pattern-excluded Automatic files", () => {
        const entries: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] = {
            "CONFIG/a.json": { key: "CONFIG/a.json", mode: MODE_PAUSED, files: [] },
            "CONFIG/b.json": { key: "CONFIG/b.json", mode: MODE_AUTOMATIC, files: [] },
            "CONFIG/c.json": { key: "CONFIG/c.json", mode: MODE_SHINY, files: [] },
        };
        expect(isCustomisationItemExcludedFromConfigSync("CONFIG/a.json", entries)).toBe(true);
        expect(isCustomisationItemExcludedFromConfigSync("CONFIG/b.json", entries)).toBe(true);
        expect(isCustomisationItemExcludedFromConfigSync("CONFIG/c.json", entries)).toBe(false);
        expect(isCustomisationItemExcludedFromConfigSync("CONFIG/d.json", entries)).toBe(false);

        expect(categoryToFolder("CONFIG", ".obsidian")).toBe(".obsidian/");
        expect(categoryToFolder("THEME", ".obsidian")).toBe(".obsidian/themes/");
        expect(categoryToFolder("SNIPPET", ".obsidian")).toBe(".obsidian/snippets/");
        expect(categoryToFolder("PLUGIN_MAIN", ".obsidian")).toBe(".obsidian/plugins/");
        expect(categoryToFolder("UNKNOWN", ".obsidian")).toBe("");

        expect(
            isCaseInsensitiveSelection({ handleFilenameCaseSensitive: false }, { isStorageInsensitive: () => false })
        ).toBe(true);
        expect(
            isCaseInsensitiveSelection({ handleFilenameCaseSensitive: true }, { isStorageInsensitive: () => false })
        ).toBe(false);
        expect(
            isCaseInsensitiveSelection({ handleFilenameCaseSensitive: true }, { isStorageInsensitive: () => true })
        ).toBe(true);

        expect(
            getHiddenFileSyncPatternExcludedFiles(
                [".obsidian/plugins/demo/main.js", ".obsidian/plugins/demo/data.json"],
                (file) => file.endsWith(".json")
            )
        ).toEqual([".obsidian/plugins/demo/main.js"]);
    });
});
