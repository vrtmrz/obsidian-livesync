import { describe, expect, it, vi } from "vitest";

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

import {
    LOG_LEVEL_VERBOSE,
    type FilePathWithPrefix,
    type LoadedEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import { createCustomisationSyncCodec } from "./customisationSyncCodec.ts";
import { CustomisationSyncCatalogueState } from "./customisationSyncCatalogueState.ts";
import { CustomisationSyncContext } from "./customisationSyncContext.ts";
import { createCustomisationSyncTestDependencies } from "./customisationSyncContext.unit.fixture.ts";

const path = "ix:device-a/PLUGIN_MAIN/example%manifest.json" as FilePathWithPrefix;
const confKey = "device-a/plugins/example";
const codec = createCustomisationSyncCodec({
    digestHash,
    parseYaml: () => undefined,
});

function loadedManifest(manifestSource: string, mtime: number): LoadedEntry {
    const data = `${codec.dummyHead}${codec.dummyEnd}${btoa(manifestSource)}`;
    return {
        _id: "entry-id",
        _rev: "1-a",
        path,
        type: "plain",
        datatype: "plain",
        data,
        ctime: 10,
        mtime,
        size: data.length,
        children: [],
        eden: {},
    } as unknown as LoadedEntry;
}

function createContext() {
    const log = vi.fn();
    const catalogueState = new CustomisationSyncCatalogueState();
    const pluginManifests = catalogueState.manifestLookup;
    const loadedManifest_mTime = catalogueState.loadedManifestMTime;
    const setManifests = vi.spyOn(catalogueState.manifests, "set");
    const setCatalogue = vi.spyOn(catalogueState.catalogue, "set");
    const context = Object.create(CustomisationSyncContext.prototype) as CustomisationSyncContext;
    Object.assign(context, {
        dependencies: createCustomisationSyncTestDependencies({
            log,
            getLocalDatabase: () => ({ getDBEntry: async () => false }) as never,
        }),
        catalogueState,
    });
    return {
        context,
        loadedManifest_mTime,
        log,
        pluginManifests,
        setCatalogue,
        setManifests,
    };
}

describe("compatibility: Customisation Sync V2 manifest state", () => {
    it("keeps the first parsed manifest when a later file has a different mtime", async () => {
        const { context, loadedManifest_mTime, pluginManifests, setManifests } = createContext();

        await context.testing.createPluginDataExFileV2(
            path,
            loadedManifest(JSON.stringify({ id: "example", name: "First", version: "1.0.0" }), 20)
        );
        await context.testing.createPluginDataExFileV2(
            path,
            loadedManifest(JSON.stringify({ id: "example", name: "Second", version: "2.0.0" }), 30)
        );

        expect(pluginManifests.get(confKey)).toMatchObject({ name: "First", version: "1.0.0" });
        expect(loadedManifest_mTime.get(confKey)).toBe(20);
        expect(setManifests).toHaveBeenCalledOnce();
    });

    it("records a failed manifest mtime and does not retry the same revision", async () => {
        const { context, loadedManifest_mTime, log, pluginManifests, setCatalogue } = createContext();
        const invalid = loadedManifest("{invalid", 20);

        await expect(context.testing.createPluginDataExFileV2(path, invalid)).resolves.toMatchObject({
            filename: "plugins/example/manifest.json",
        });
        await context.testing.createPluginDataExFileV2(path, invalid);

        expect(pluginManifests.has(confKey)).toBe(false);
        expect(loadedManifest_mTime.get(confKey)).toBe(20);
        expect(log).toHaveBeenCalledTimes(2);
        expect(log).toHaveBeenNthCalledWith(
            1,
            `The file ${path} seems to manifest, but could not be decoded as JSON`,
            LOG_LEVEL_VERBOSE,
            undefined
        );
        expect(log).toHaveBeenNthCalledWith(2, expect.any(SyntaxError), LOG_LEVEL_VERBOSE, undefined);
        expect(setCatalogue).toHaveBeenCalledOnce();
    });
});
