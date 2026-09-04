import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@/deps.ts";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

import { CustomisationSyncCatalogueState } from "./customisationSyncCatalogueState.ts";
import { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";
import type { IPluginDataExDisplay, LoadedEntryPluginDataExFile } from "./customisationSyncView.ts";

function display(documentPath = "ix:device-a/PLUGIN_MAIN/example.md"): IPluginDataExDisplay {
    return {
        documentPath: documentPath as FilePathWithPrefix,
        category: "PLUGIN_MAIN",
        name: "example",
        term: "device-a",
        files: [],
        mtime: 1,
    };
}

function file(filename: string, mtime: number): LoadedEntryPluginDataExFile {
    return {
        path: `ix:device-a/PLUGIN_MAIN/example%${filename}` as FilePathWithPrefix,
        filename,
        mtime,
        data: [filename],
        size: filename.length,
    } as LoadedEntryPluginDataExFile;
}

describe("Customisation Sync catalogue state", () => {
    it("publishes V1 replacement and keeps V2 replacement delayed", async () => {
        const state = new CustomisationSyncCatalogueState();
        const setCatalogue = vi.spyOn(state.catalogue, "set");
        const row = display();

        state.replacePlugin(row);
        expect(get(state.catalogue)).toEqual([row]);
        expect(setCatalogue).toHaveBeenCalledOnce();

        const v2 = new PluginDataExDisplayV2(
            {
                ...display(),
                files: [file("main.js", 1)],
            },
            state.manifestLookup
        );
        await state.updateV2Plugin(v2, file("main.js", 2), "main.js");

        expect(get(state.catalogue)).toEqual([row]);
        expect(state.findPlugin(row.documentPath)).toBe(v2);
        state.publishCatalogue();
        expect(get(state.catalogue)).toEqual([v2]);
    });

    it("retains the first parsed manifest and records failed mtimes", () => {
        const state = new CustomisationSyncCatalogueState();
        const first = { name: "First", version: "1.0.0" } as PluginManifest;
        const parseManifest = vi.fn(() => first);

        state.processManifest("device-a/plugins/example", 20, parseManifest);
        state.processManifest(
            "device-a/plugins/example",
            30,
            () => ({ name: "Second", version: "2.0.0" }) as PluginManifest
        );

        expect(state.manifestLookup.get("device-a/plugins/example")).toBe(first);
        expect(state.loadedManifestMTime.get("device-a/plugins/example")).toBe(20);
        expect(parseManifest).toHaveBeenCalledOnce();

        const failedState = new CustomisationSyncCatalogueState();
        const onParseError = vi.fn();
        const failure = new SyntaxError("invalid");
        failedState.processManifest(
            "device-a/plugins/failure",
            40,
            () => {
                throw failure;
            },
            onParseError
        );
        failedState.processManifest("device-a/plugins/failure", 40, () => first, onParseError);

        expect(onParseError).toHaveBeenCalledWith(failure);
        expect(failedState.loadedManifestMTime.get("device-a/plugins/failure")).toBe(40);
        expect(failedState.manifestLookup.has("device-a/plugins/failure")).toBe(false);
    });

    it("clears rows and loaded mtimes on reload while retaining manifest lookup", () => {
        const state = new CustomisationSyncCatalogueState();
        const key = "device-a/plugins/example";
        state.processManifest(key, 20, () => ({ name: "Example" }) as PluginManifest);
        state.replacePlugin(display());

        state.clearForReload();

        expect(get(state.catalogue)).toEqual([]);
        expect(state.loadedManifestMTime.size).toBe(0);
        expect(state.manifestLookup.get(key)).toEqual({ name: "Example" });
        expect(get(state.catalogue)).toEqual([]);
    });

    it("keeps manifest caches through the narrower disabled refresh", () => {
        const state = new CustomisationSyncCatalogueState();
        const key = "device-a/plugins/example";
        state.processManifest(key, 20, () => ({ name: "Example" }) as PluginManifest);
        state.replacePlugin(display());

        state.clearForDisabledRefresh();

        expect(get(state.catalogue)).toEqual([]);
        expect(state.loadedManifestMTime.get(key)).toBe(20);
        expect(state.manifestLookup.has(key)).toBe(true);
    });

    it("tracks V2 updates through migration progress", () => {
        const state = new CustomisationSyncCatalogueState();

        state.beginUpdate();
        state.beginUpdate();
        expect(get(state.migrationProgress)).toBe(2);
        state.endUpdate();
        state.endUpdate();
        expect(get(state.migrationProgress)).toBe(0);
    });
});
