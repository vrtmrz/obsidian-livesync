import { describe, expect, it } from "vitest";
import { MODE_AUTOMATIC, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { getAutomaticSyncTargetFiles } from "./getAutomaticSyncTargetFiles.ts";

function createEntries(): ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] {
    return {
        "CONFIG/app.json": { key: "CONFIG/app.json", mode: MODE_AUTOMATIC, files: ["app.json"] },
        "PLUGIN_MAIN/example": {
            key: "PLUGIN_MAIN/example",
            mode: MODE_AUTOMATIC,
            files: ["plugins/example/main.js", "plugins/example/manifest.json"],
        },
        "PLUGIN_DATA/example": {
            key: "PLUGIN_DATA/example",
            mode: MODE_AUTOMATIC,
            files: ["plugins/example/data.json"],
        },
        "PLUGIN_ETC/example": {
            key: "PLUGIN_ETC/example",
            mode: MODE_AUTOMATIC,
            files: ["plugins/example/extra.json"],
        },
        "PLUGIN_MAIN/other": {
            key: "PLUGIN_MAIN/other",
            mode: MODE_AUTOMATIC,
            files: ["plugins/other/main.js"],
        },
    };
}

describe("getAutomaticSyncTargetFiles", () => {
    it("initialises a single selected item in the current configuration directory", () => {
        expect(getAutomaticSyncTargetFiles("CONFIG/app.json", ".custom-config", createEntries())).toEqual([
            ".custom-config/app.json",
        ]);
    });

    it("initialises both saved child selections when the whole plug-in is selected", () => {
        expect(getAutomaticSyncTargetFiles("PLUGIN_ALL/example", ".obsidian", createEntries())).toEqual([
            ".obsidian/plugins/example/data.json",
            ".obsidian/plugins/example/main.js",
            ".obsidian/plugins/example/manifest.json",
        ]);
    });

    it("retains the available child files when the other child has no saved entry", () => {
        const entries = createEntries();
        delete entries["PLUGIN_DATA/example"];
        expect(getAutomaticSyncTargetFiles("PLUGIN_ALL/example", ".obsidian", entries)).toEqual([
            ".obsidian/plugins/example/main.js",
            ".obsidian/plugins/example/manifest.json",
        ]);
    });

    it("keeps an empty selection empty rather than including unrelated plug-ins", () => {
        expect(getAutomaticSyncTargetFiles("PLUGIN_ALL/absent", ".obsidian", createEntries())).toEqual([]);
    });
});
