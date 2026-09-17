import { describe, expect, it, vi } from "vitest";

const asyncHarness = vi.hoisted(() => ({
    delay: vi.fn(async () => undefined),
    fireAndForget: vi.fn((operation: () => unknown) => {
        void operation();
    }),
}));

vi.mock("@/deps.ts", () => ({
    diff_match_patch: class DiffMatchPatch {},
    parseYaml: vi.fn(),
}));
vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/compat/common/utils")>();
    return {
        ...actual,
        delay: asyncHarness.delay,
        fireAndForget: asyncHarness.fireAndForget,
    };
});

import type { FilePath, FilePathWithPrefix, LoadedEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { PluginManifest } from "@/deps.ts";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";
import { createCustomisationSyncCodec, type PluginDataEx } from "./customisationSyncCodec.ts";
import { ApplicationOperations, type ApplicationOperationsDependencies } from "./applicationOperations.ts";
import { PluginDataExDisplayV2 } from "./customisationSyncModel.ts";
import type { SnapshotPersistenceResult } from "./snapshotPersistence.ts";
import { SnapshotOperations } from "./snapshotOperations.ts";
import type { IPluginDataExDisplay } from "./customisationSyncView.ts";

const codec = createCustomisationSyncCodec({ digestHash, parseYaml: () => undefined });

function createOperations() {
    const events: string[] = [];
    let usePluginSyncV2 = false;
    type PersistenceResult = SnapshotPersistenceResult<true>;
    const getDBEntry = vi.fn(async (_path: FilePathWithPrefix) => false as false | LoadedEntry);
    const ensureDir = vi.fn(async (_path: string) => {
        events.push("ensure-dir");
        return true;
    });
    const readHiddenFileBinary = vi.fn(async (_path: string) => new ArrayBuffer(0));
    const readHiddenFileText = vi.fn(async (_path: string) => "");
    const writeHiddenFileAuto = vi.fn(async (_path: string, _data: string | ArrayBuffer) => {
        events.push("write-file");
        return true;
    });
    const storeCustomisationFileV2 = vi.fn(
        async (): Promise<PersistenceResult> => ({
            value: true,
            status: "saved" as const,
            refreshes: [] as const,
        })
    );
    const storeCustomizationFiles = vi.fn(
        async (): Promise<PersistenceResult> => ({
            value: true,
            status: "saved" as const,
            refreshes: [] as const,
        })
    );
    const deleteConfigOnDatabase = vi.fn(
        async (): Promise<PersistenceResult> => ({
            value: true,
            status: "deleted" as const,
            refreshes: [] as const,
        })
    );
    const updatePluginList = vi.fn(async (showMessage: boolean, _path?: FilePathWithPrefix | FilePath) => {
        events.push(`refresh-v1:${showMessage}`);
    });
    const updatePluginListV2 = vi.fn(async (_showMessage: boolean, _path: FilePathWithPrefix) => {
        events.push("refresh-v2");
    });
    const findPlugins = vi.fn(() => [] as readonly IPluginDataExDisplay[]);
    const reloadPlugin = vi.fn(async (_configDir: string, _pluginName: string) => {
        events.push("reload-plugin");
    });
    const askRestart = vi.fn(() => {
        events.push("ask-restart");
    });
    const catalogueOperations = {
        findPlugins,
        manifestLookup: new Map<string, PluginManifest>(),
        updatePluginList,
        updatePluginListV2,
    };
    const snapshotOperations = new SnapshotOperations({
        getSettings: () => ({ usePluginSyncV2 }),
        getDeviceAndVaultName: () => "device-a",
        log: vi.fn(),
        snapshotPersistence: {
            storeCustomisationFileV2,
            storeCustomizationFiles,
            deleteConfigOnDatabase,
        },
        catalogueOperations,
    });
    const dependencies: ApplicationOperationsDependencies = {
        getLocalDatabase: () => ({ getDBEntry }),
        storageAccess: {
            ensureDir,
            readHiddenFileBinary,
            readHiddenFileText,
            writeHiddenFileAuto,
        },
        path: {
            filenameToUnifiedKey: (path, term) => `ix:${term}/CONFIG/${path.split("/").pop()}.md` as FilePathWithPrefix,
        },
        log: vi.fn(),
        getConfigDir: () => ".obsidian",
        getDeviceAndVaultName: () => "device-a",
        resolveJsonConflict: vi.fn(async () => false),
        selectTextFile: vi.fn(async (): Promise<"A" | "B" | false> => false),
        reloadPlugin,
        askRestart,
        snapshotOperations,
        catalogueOperations,
    };
    return {
        application: new ApplicationOperations(dependencies),
        dependencies,
        events,
        setUseV2: (value: boolean) => {
            usePluginSyncV2 = value;
        },
        getDBEntry,
        persistence: { deleteConfigOnDatabase, storeCustomisationFileV2, storeCustomizationFiles },
        catalogue: { findPlugins, updatePluginList, updatePluginListV2 },
        storage: { ensureDir, readHiddenFileBinary, readHiddenFileText, writeHiddenFileAuto },
        reloadPlugin,
        askRestart,
    };
}

const display = {
    documentPath: "ix:device-a/PLUGIN_DATA/example.md" as FilePathWithPrefix,
    category: "PLUGIN_DATA",
    name: "example",
    term: "device-a",
    files: [
        { filename: "plugins/example/data.json", data: ["a"], mtime: 1, size: 1 },
        { filename: "plugins/example/other.json", data: ["b"], mtime: 2, size: 1 },
    ],
    mtime: 2,
} satisfies IPluginDataExDisplay;

describe("Customisation Sync application operations", () => {
    it("keeps file-level comparison clones and duplication behaviour inside the owner", async () => {
        const fixture = createOperations();
        const compareUsingDisplayData = vi
            .spyOn(fixture.application, "compareUsingDisplayData")
            .mockResolvedValue(true);

        await expect(
            fixture.application.compareFileUsingDisplayData(display, display, "plugins/example/data.json")
        ).resolves.toBe(true);
        const [left, right, compareEach] = compareUsingDisplayData.mock.calls[0];
        expect(left.files.map((file) => file.filename)).toEqual(["plugins/example/data.json"]);
        expect(right.files.map((file) => file.filename)).toEqual(["plugins/example/data.json"]);
        expect(compareEach).toBe(true);
        expect(display.files).toHaveLength(2);

        await fixture.application.duplicateData(display, "device-b");
        expect(fixture.persistence.storeCustomizationFiles).toHaveBeenCalledWith(
            ".obsidian/plugins/example/data.json",
            "device-b"
        );
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledWith(false, "ix:device-b/CONFIG/data.json.md");
    });

    it("uses the compared filename for legacy file comparisons", async () => {
        const fixture = createOperations();

        await expect(
            fixture.application.compareFileUsingDisplayData(display, display, "plugins/example/data.json")
        ).resolves.toBe(false);
        expect(fixture.dependencies.resolveJsonConflict).toHaveBeenCalledWith(
            "data.json",
            expect.any(Array),
            "device-a",
            expect.any(Function)
        );
    });

    it("awaits V1 refreshes before the explicit effect and preserves reload ordering", async () => {
        const fixture = createOperations();
        fixture.setUseV2(false);
        fixture.persistence.storeCustomizationFiles.mockImplementation(async () => {
            fixture.events.push("persist");
            return {
                value: true,
                status: "saved" as const,
                refreshes: [
                    {
                        mode: "v1" as const,
                        timing: "await" as const,
                        path: "ix:device-a/PLUGIN_MAIN/example.md" as FilePathWithPrefix,
                    },
                ],
            };
        });
        fixture.getDBEntry.mockResolvedValue({
            data: codec.serialize({
                category: "PLUGIN_MAIN",
                name: "example",
                term: "device-a",
                files: [{ filename: "plugins/example/main.js", data: ["source"], mtime: 1, size: 6 }],
                mtime: 1,
            } satisfies PluginDataEx),
        } as LoadedEntry);

        const data = { ...display, category: "PLUGIN_MAIN", name: "example" } satisfies IPluginDataExDisplay;
        await expect(fixture.application.applyData(data, "replacement")).resolves.toBe(true);

        expect(fixture.events).toEqual([
            "ensure-dir",
            "write-file",
            "persist",
            "refresh-v1:false",
            "refresh-v1:true",
            "reload-plugin",
        ]);
        expect(fixture.reloadPlugin).toHaveBeenCalledWith(".obsidian", "example");
        expect(asyncHarness.delay).toHaveBeenCalledWith(100);
    });

    it("starts V2 catalogue refreshes without awaiting them", async () => {
        const fixture = createOperations();
        let releaseRefresh!: () => void;
        const refresh = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
        });
        fixture.setUseV2(true);
        fixture.persistence.storeCustomisationFileV2.mockResolvedValue({
            value: true,
            status: "saved",
            refreshes: [
                {
                    mode: "v2",
                    timing: "fire-and-forget",
                    path: "ix:device-a/CONFIG/app.json%app.json" as FilePathWithPrefix,
                },
            ],
        });
        fixture.catalogue.updatePluginListV2.mockImplementation(async () => await refresh);
        const data = new PluginDataExDisplayV2(
            {
                ...display,
                files: [{ filename: "app.json", data: ["source"], mtime: 1, size: 6 }],
            },
            new Map()
        );

        await expect(fixture.application.applyData(data, "replacement")).resolves.toBe(true);
        expect(fixture.catalogue.updatePluginListV2).toHaveBeenCalledWith(
            false,
            "ix:device-a/CONFIG/app.json%app.json"
        );
        releaseRefresh();
        await refresh;
    });

    it("deletes the V2 files and binder through the direct owners", async () => {
        const fixture = createOperations();
        fixture.setUseV2(true);
        const v2Path = "ix:device-a/PLUGIN_DATA/example%data.json" as FilePathWithPrefix;
        const binderPath = "ix:device-a/PLUGIN_DATA/example.md" as FilePathWithPrefix;
        const v2Entry = new PluginDataExDisplayV2(
            {
                ...display,
                documentPath: binderPath,
                files: [
                    {
                        filename: "data.json",
                        path: v2Path,
                        data: ["source"],
                        mtime: 1,
                        ctime: 1,
                        size: 6,
                        datatype: "plain",
                    } as never,
                ],
            },
            new Map()
        );
        fixture.catalogue.findPlugins.mockReturnValue([v2Entry]);

        await expect(
            fixture.application.deleteData({
                ...display,
                documentPath: binderPath,
            })
        ).resolves.toBe(true);

        expect(fixture.persistence.deleteConfigOnDatabase).toHaveBeenNthCalledWith(1, v2Path, false);
        expect(fixture.persistence.deleteConfigOnDatabase).toHaveBeenNthCalledWith(2, binderPath, false);
        expect(fixture.catalogue.updatePluginList).toHaveBeenNthCalledWith(1, false, v2Path);
        expect(fixture.catalogue.updatePluginList).toHaveBeenNthCalledWith(2, false, binderPath);
    });
});
