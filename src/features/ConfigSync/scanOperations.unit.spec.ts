import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

const asyncHarness = vi.hoisted(() => ({
    fireAndForget: vi.fn((operation: () => unknown) => {
        void operation();
    }),
}));

vi.mock("@/common/translation", () => ({
    $msg: vi.fn((message: string) => message),
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/utils", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/compat/common/utils")>();
    return {
        ...actual,
        fireAndForget: asyncHarness.fireAndForget,
    };
});

import { ScanOperations, type ScanOperationsDependencies } from "./scanOperations.ts";

type ScanEntry = {
    _id: FilePathWithPrefix;
    path: FilePathWithPrefix;
    deleted?: boolean;
};

type FixtureOptions = {
    useV2?: boolean;
    usePluginSync?: boolean;
    term?: string;
    files?: FilePath[];
    targetFiles?: FilePath[];
    databaseEntries?: ScanEntry[];
    v1Paths?: Record<string, FilePathWithPrefix>;
    v2Paths?: Record<string, FilePathWithPrefix>;
    ownsLocalFile?: (path: FilePath) => boolean;
    ownsLocalDocument?: (path: FilePathWithPrefix) => boolean;
    listFiles?: (path: string) => Promise<{ files: readonly string[]; folders: readonly string[] }>;
};

function asyncEntries<T>(entries: readonly T[]) {
    return {
        async *[Symbol.asyncIterator]() {
            yield* entries;
        },
    };
}

function createFixture(options: FixtureOptions = {}) {
    const files = options.files ?? [];
    const term = options.term ?? "device-a";
    const databaseEntries = options.databaseEntries ?? [];
    const v1Paths = options.v1Paths ?? {};
    const v2Paths = options.v2Paths ?? {};
    const log = vi.fn();
    const allDocsRaw = vi.fn(async () => ({
        rows: databaseEntries.map((doc) => ({ id: doc._id, doc })),
    }));
    const findEntries = vi.fn(() => asyncEntries(databaseEntries));
    const storeCustomisationFileV2 = vi.fn(async (_path: FilePath, _term: string) => true);
    const storeCustomizationFiles = vi.fn(async (_path: FilePath) => true);
    const deleteConfigOnDatabase = vi.fn(async (_path: FilePathWithPrefix) => true);
    const updatePluginList = vi.fn(async (_showMessage: boolean) => undefined);
    const listFiles = vi.fn(
        options.listFiles ??
            (async () => ({ files, folders: [] }) as { files: readonly string[]; folders: readonly string[] })
    );
    const dependencies = {
        listFiles,
        getSettings: () => ({ usePluginSyncV2: options.useV2 ?? false, usePluginSync: options.usePluginSync ?? true }),
        getLocalDatabase: () => ({ allDocsRaw, findEntries }),
        path: {
            isTargetPath: (path: string) => options.targetFiles?.includes(path as FilePath) ?? true,
            filenameToUnifiedKey: (path: string) =>
                v1Paths[path] ?? (`ix:${term}/CONFIG/${path.split("/").pop()}.md` as FilePathWithPrefix),
            filenameWithUnifiedKey: (path: string) =>
                v2Paths[path] ??
                (`ix:${term}/CONFIG/${path.split("/").pop()}%${path.split("/").pop()}` as FilePathWithPrefix),
            unifiedKeyPrefixOfTerminal: (termOverride?: string) => `ix:${termOverride ?? term}/` as FilePathWithPrefix,
            getPath: (entry: ScanEntry) => entry.path,
        },
        log,
        getConfigDir: () => ".obsidian",
        getDeviceAndVaultName: () => term,
        ownsLocalFile: options.ownsLocalFile ?? (() => true),
        ownsLocalDocument: options.ownsLocalDocument ?? (() => true),
        snapshotOperations: {
            storeCustomisationFileV2,
            storeCustomizationFiles,
            deleteConfigOnDatabase,
        },
        catalogueOperations: { updatePluginList },
    } as unknown as ScanOperationsDependencies;
    return {
        operations: new ScanOperations(dependencies),
        dependencies,
        listFiles,
        log,
        allDocsRaw,
        findEntries,
        snapshot: { storeCustomisationFileV2, storeCustomizationFiles, deleteConfigOnDatabase },
        catalogue: { updatePluginList },
    };
}

describe("ScanOperations", () => {
    beforeEach(() => {
        asyncHarness.fireAndForget.mockClear();
    });

    it("filters the bounded file tree and logs traversal errors", async () => {
        const traversalError = new Error("cannot read folder");
        const listFiles = vi.fn(async (path: string) => {
            switch (path) {
                case ".obsidian":
                    return {
                        files: [".obsidian/app.json", "settings.json", ".trash/root.json"],
                        folders: [".obsidian/plugins", ".trash", ".obsidian/unreadable"],
                    };
                case ".obsidian/plugins":
                    return {
                        files: [".obsidian/plugins/example/data.json"],
                        folders: [".obsidian/plugins/example"],
                    };
                case ".obsidian/plugins/example":
                    return {
                        files: [".obsidian/plugins/example/manifest.json"],
                        folders: [".obsidian/plugins/example/deeper"],
                    };
                case ".trash":
                    return { files: [".trash/ignored.json"], folders: [] };
                case ".obsidian/unreadable":
                    throw traversalError;
                default:
                    throw new Error(`unexpected traversal: ${path}`);
            }
        });
        const fixture = createFixture({ listFiles });

        await expect(fixture.operations.scanInternalFiles()).resolves.toEqual([
            ".obsidian/app.json",
            ".obsidian/plugins/example/data.json",
            ".obsidian/plugins/example/manifest.json",
        ]);

        expect(listFiles).not.toHaveBeenCalledWith(".obsidian/plugins/example/deeper");
        expect(fixture.log).toHaveBeenCalledWith(
            "Could not traverse(CustomisationSync):.obsidian/unreadable",
            LOG_LEVEL_INFO,
            undefined
        );
        expect(fixture.log).toHaveBeenCalledWith(traversalError, LOG_LEVEL_VERBOSE, undefined);
    });

    it("stops before traversal when the device term is empty", async () => {
        const fixture = createFixture({ term: "", usePluginSync: false, files: [".obsidian/app.json"] as FilePath[] });

        await fixture.operations.scanAllConfigFiles(true);

        expect(fixture.listFiles).not.toHaveBeenCalled();
        expect(fixture.allDocsRaw).not.toHaveBeenCalled();
        expect(fixture.findEntries).not.toHaveBeenCalled();
        expect(fixture.snapshot.storeCustomizationFiles).not.toHaveBeenCalled();
        expect(fixture.snapshot.storeCustomisationFileV2).not.toHaveBeenCalled();
        expect(fixture.snapshot.deleteConfigOnDatabase).not.toHaveBeenCalled();
        expect(fixture.catalogue.updatePluginList).not.toHaveBeenCalled();
        expect(fixture.log).toHaveBeenCalledWith("Scanning customizing files.", LOG_LEVEL_NOTICE, "scan-all-config");
        expect(fixture.log).toHaveBeenCalledWith("We have to configure the device name", LOG_LEVEL_NOTICE, undefined);
    });

    it("dispatches according to the current V1/V2 setting on each scan", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const fixture = createFixture({ files: [path], useV2: false });
        let useV2 = false;
        fixture.dependencies.getSettings = () => ({ usePluginSyncV2: useV2 });

        await fixture.operations.scanAllConfigFiles(false);
        useV2 = true;
        await fixture.operations.scanAllConfigFiles(false);

        expect(fixture.snapshot.storeCustomizationFiles).toHaveBeenCalledWith(path);
        expect(fixture.snapshot.storeCustomizationFiles).toHaveBeenCalledTimes(1);
        expect(fixture.snapshot.storeCustomisationFileV2).toHaveBeenCalledWith(path, "device-a");
        expect(fixture.snapshot.storeCustomisationFileV2).toHaveBeenCalledTimes(1);
    });

    it("routes V1 ownership and deletes only stale owned documents", async () => {
        const ownedPath = ".obsidian/app.json" as FilePath;
        const unownedPath = ".obsidian/appearance.json" as FilePath;
        const ownedDocument = "ix:device-a/CONFIG/app.json.md" as FilePathWithPrefix;
        const unownedDocument = "ix:device-a/CONFIG/appearance.json.md" as FilePathWithPrefix;
        const staleDocument = "ix:device-a/CONFIG/stale.json.md" as FilePathWithPrefix;
        const fixture = createFixture({
            useV2: false,
            usePluginSync: false,
            files: [ownedPath, unownedPath],
            v1Paths: {
                [ownedPath]: ownedDocument,
                [unownedPath]: unownedDocument,
            },
            databaseEntries: [
                { _id: ownedDocument, path: ownedDocument },
                { _id: unownedDocument, path: unownedDocument },
                { _id: staleDocument, path: staleDocument },
            ],
            ownsLocalFile: (path) => path == ownedPath,
        });

        await fixture.operations.scanAllConfigFiles(false);

        expect(fixture.snapshot.storeCustomizationFiles).toHaveBeenCalledWith(ownedPath);
        expect(fixture.snapshot.storeCustomizationFiles).toHaveBeenCalledTimes(1);
        expect(fixture.snapshot.deleteConfigOnDatabase).toHaveBeenCalledWith(staleDocument);
        expect(fixture.snapshot.deleteConfigOnDatabase).toHaveBeenCalledTimes(1);
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledWith(false);
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledTimes(1);
        expect(fixture.allDocsRaw).toHaveBeenCalledWith({
            startkey: "ix:",
            endkey: "ix:\u{10ffff}",
            include_docs: true,
        });
    });

    it("propagates V1 snapshot failures without publishing a final refresh", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const failure = new Error("V1 write failed");
        const fixture = createFixture({ files: [path] });
        fixture.snapshot.storeCustomizationFiles.mockRejectedValueOnce(failure);

        await expect(fixture.operations.scanAllConfigFiles(false)).rejects.toBe(failure);

        expect(fixture.catalogue.updatePluginList).not.toHaveBeenCalled();
    });

    it("routes V2 ownership, removes matched keys, and deletes stale documents", async () => {
        const ownedPath = ".obsidian/app.json" as FilePath;
        const unownedPath = ".obsidian/appearance.json" as FilePath;
        const extraPath = ".obsidian/plugins/example/main.js" as FilePath;
        const ownedDocument = "ix:device-a/CONFIG/app.json%app.json" as FilePathWithPrefix;
        const unownedDocument = "ix:device-a/CONFIG/appearance.json%appearance.json" as FilePathWithPrefix;
        const staleDocument = "ix:device-a/CONFIG/stale.json" as FilePathWithPrefix;
        const skippedDocument = "ix:device-a/CONFIG/skipped%app.json" as FilePathWithPrefix;
        const owned = new Set([ownedPath, extraPath]);
        const fixture = createFixture({
            useV2: true,
            files: [ownedPath, unownedPath, extraPath],
            v2Paths: {
                [ownedPath]: ownedDocument,
                [unownedPath]: unownedDocument,
                [extraPath]: "ix:device-a/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix,
            },
            databaseEntries: [
                { _id: ownedDocument, path: "ix:device-a/CONFIG/app.json.md" as FilePathWithPrefix },
                { _id: unownedDocument, path: "ix:device-a/CONFIG/appearance.json.md" as FilePathWithPrefix },
                { _id: staleDocument, path: staleDocument },
                { _id: skippedDocument, path: skippedDocument },
            ],
            ownsLocalFile: (path) => owned.has(path),
        });

        await fixture.operations.scanAllConfigFiles(false);

        expect(fixture.snapshot.storeCustomisationFileV2).toHaveBeenCalledWith(ownedPath, "device-a");
        expect(fixture.snapshot.storeCustomisationFileV2).toHaveBeenCalledWith(extraPath, "device-a");
        expect(fixture.snapshot.storeCustomisationFileV2).toHaveBeenCalledTimes(2);
        expect(fixture.snapshot.storeCustomisationFileV2).not.toHaveBeenCalledWith(unownedPath, "device-a");
        expect(fixture.snapshot.deleteConfigOnDatabase).toHaveBeenCalledWith(staleDocument);
        expect(fixture.snapshot.deleteConfigOnDatabase).toHaveBeenCalledTimes(1);
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledWith(false);
        expect(fixture.findEntries).toHaveBeenCalledWith("ix:device-a/", "ix:device-a/\u{10ffff}", {
            include_docs: true,
        });
    });

    it("catches and logs each V2 entry failure before publishing the refresh", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const document = "ix:device-a/CONFIG/app.json%app.json" as FilePathWithPrefix;
        const failure = new Error("V2 write failed");
        const fixture = createFixture({
            useV2: true,
            files: [path],
            v2Paths: { [path]: document },
            databaseEntries: [{ _id: document, path: "ix:device-a/CONFIG/app.json.md" as FilePathWithPrefix }],
        });
        fixture.snapshot.storeCustomisationFileV2.mockRejectedValueOnce(failure);

        await fixture.operations.scanAllConfigFiles(false);

        expect(fixture.log).toHaveBeenCalledWith(
            `scanAllConfigFiles - Error: ${document}`,
            LOG_LEVEL_VERBOSE,
            undefined
        );
        expect(fixture.log).toHaveBeenCalledWith(failure, LOG_LEVEL_VERBOSE, undefined);
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledWith(false);
    });

    it("starts the final catalogue refresh without awaiting it", async () => {
        const path = ".obsidian/app.json" as FilePath;
        const fixture = createFixture({ files: [path] });
        let releaseRefresh!: () => void;
        const refresh = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
        });
        const refreshStarted = vi.fn();
        fixture.catalogue.updatePluginList.mockImplementation(async () => {
            refreshStarted();
            await refresh;
        });

        await fixture.operations.scanAllConfigFiles(false);

        expect(asyncHarness.fireAndForget).toHaveBeenCalledOnce();
        expect(refreshStarted).toHaveBeenCalledOnce();
        expect(fixture.catalogue.updatePluginList).toHaveBeenCalledWith(false);
        releaseRefresh();
        await refresh;
    });
});
