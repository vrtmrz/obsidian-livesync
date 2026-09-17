import { describe, expect, it } from "vitest";
import type { PluginManifest } from "@/deps.ts";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";
import type { IPluginDataExDisplay, LoadedEntryPluginDataExFile } from "./customisationSyncView.ts";

function file(filename: string, mtime: number, data: string[]): LoadedEntryPluginDataExFile {
    return { filename, mtime, data, size: data.join("").length } as LoadedEntryPluginDataExFile;
}

function display(files: LoadedEntryPluginDataExFile[] = []): IPluginDataExDisplay {
    return {
        documentPath: "ix:device-a/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix,
        category: "PLUGIN_MAIN",
        name: "example",
        term: "device-a",
        files,
        mtime: 0,
    };
}

describe("PluginDataExDisplayV2", () => {
    it("projects manifest identity and file modification time", () => {
        const manifests = new Map([
            ["device-a/plugins/example", { name: "Example plug-in", version: "1.2.3" } as PluginManifest],
        ]);
        const model = new PluginDataExDisplayV2(
            display([file("main.js", 10, ["main"]), file("data.json", 20, ["data"])]),
            manifests
        );

        expect(model.confKey).toBe("device-a/plugins/example");
        expect(model.displayName).toBe("Example plug-in");
        expect(model.version).toBe("1.2.3");
        expect(model.mtime).toBe(15);
    });

    it("retains an unchanged file and replaces changed content", async () => {
        const original = file("main.js", 10, ["same"]);
        const model = new PluginDataExDisplayV2(display([original]), new Map());

        await model.setFile(file("main.js", 10, ["same"]));
        expect(model.files[0]).toBe(original);

        const changed = file("main.js", 10, ["changed"]);
        await model.setFile(changed);
        expect(model.files).toEqual([changed]);
    });

    it("deletes only the named file", () => {
        const retained = file("styles.css", 20, ["css"]);
        const model = new PluginDataExDisplayV2(display([file("main.js", 10, ["main"]), retained]), new Map());

        model.deleteFile("main.js");

        expect(model.files).toEqual([retained]);
    });
});
