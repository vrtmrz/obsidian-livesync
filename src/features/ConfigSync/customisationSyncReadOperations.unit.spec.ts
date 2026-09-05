import { describe, expect, it, vi } from "vitest";
import {
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { digestHash } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/hash";

import { createCustomisationSyncCodec, type PluginDataEx } from "./customisationSyncCodec.ts";
import {
    decodeCustomisationSyncV2File,
    loadCustomisationDisplayData,
    loadCustomisationV2Entry,
    readCustomisationFile,
} from "./customisationSyncReadOperations.ts";

const configDir = ".obsidian";
const filePath = ".obsidian/plugins/example/manifest.json" as FilePath;
const documentPath = "ix:device-a/PLUGIN_MAIN/example.md" as FilePathWithPrefix;
const stat = { ctime: 10, mtime: 20, size: 42, type: "file" } as UXStat;
const codec = createCustomisationSyncCodec({
    digestHash,
    parseYaml: () => undefined,
});

function createDependencies() {
    const localDatabase = {
        getDBEntry: vi.fn(),
        putDBEntry: vi.fn(async (_entry: unknown) => ({ ok: true, id: "id", rev: "1-a" })),
    };
    const storageAccess = {
        statHidden: vi.fn(async () => stat as UXStat | null),
        readHiddenFileBinary: vi.fn(),
    };
    const log = vi.fn();
    const dependencies = {
        getLocalDatabase: () => localDatabase as never,
        storageAccess: storageAccess as never,
        path: {
            getPath: vi.fn((entry: { path: FilePathWithPrefix }) => entry.path),
        } as never,
        log,
    };
    return { dependencies, localDatabase, log, storageAccess };
}

function loadedEntry(path: FilePathWithPrefix, data: string): LoadedEntry {
    return {
        _id: "entry-id",
        _rev: "1-a",
        path,
        type: "plain",
        datatype: "plain",
        data,
        ctime: 10,
        mtime: 20,
        size: data.length,
        children: [],
        eden: {},
    } as unknown as LoadedEntry;
}

function pluginData(hash?: string): PluginDataEx {
    return {
        category: "PLUGIN_MAIN",
        name: "example",
        term: "device-a",
        mtime: 20,
        files: [
            {
                filename: "plugins/example/main.js",
                data: ["payload"],
                mtime: 20,
                size: 7,
                hash,
            },
        ],
    };
}

describe("Customisation Sync read operations", () => {
    it("does not read content when a local file is missing", async () => {
        const { dependencies, storageAccess } = createDependencies();
        storageAccess.statHidden.mockResolvedValue(null);

        await expect(readCustomisationFile(dependencies, filePath, configDir)).resolves.toBe(false);
        expect(storageAccess.readHiddenFileBinary).not.toHaveBeenCalled();
    });

    it("propagates a storage read failure without converting it to an encoding failure", async () => {
        const { dependencies, log, storageAccess } = createDependencies();
        const error = new Error("read failed");
        storageAccess.readHiddenFileBinary.mockRejectedValue(error);

        await expect(readCustomisationFile(dependencies, filePath, configDir)).rejects.toBe(error);
        expect(log).not.toHaveBeenCalled();
    });

    it("encodes a manifest and extracts its display metadata", async () => {
        const { dependencies, storageAccess } = createDependencies();
        const source = JSON.stringify({ name: "Example plug-in", version: "1.2.3" });
        storageAccess.readHiddenFileBinary.mockResolvedValue(new TextEncoder().encode(source).buffer);

        await expect(readCustomisationFile(dependencies, filePath, configDir)).resolves.toEqual({
            filename: "plugins/example/manifest.json",
            data: [btoa(source)],
            mtime: 20,
            size: 42,
            version: "1.2.3",
            displayName: "Example plug-in",
        });
    });

    it("keeps an unreadable manifest as file data and reports only the metadata failure", async () => {
        const { dependencies, log, storageAccess } = createDependencies();
        const errorSource = "{invalid";
        storageAccess.readHiddenFileBinary.mockResolvedValue(new TextEncoder().encode(errorSource).buffer);

        await expect(readCustomisationFile(dependencies, filePath, configDir)).resolves.toMatchObject({
            filename: "plugins/example/manifest.json",
            data: [btoa(errorSource)],
            version: undefined,
            displayName: undefined,
        });
        expect(log).toHaveBeenNthCalledWith(
            1,
            `Configuration sync data: ${filePath} looks like manifest, but could not read the version`,
            LOG_LEVEL_INFO,
            undefined
        );
        expect(log).toHaveBeenNthCalledWith(2, expect.any(SyntaxError), LOG_LEVEL_VERBOSE, undefined);
    });

    it("loads V1 display data without retaining file content", async () => {
        const { dependencies, localDatabase } = createDependencies();
        const data = pluginData("known-hash");
        localDatabase.getDBEntry.mockResolvedValue(loadedEntry(documentPath, JSON.stringify(data)));

        await expect(loadCustomisationDisplayData(dependencies, documentPath, codec)).resolves.toEqual({
            ...data,
            documentPath,
            files: [{ ...data.files[0], data: ["known-hash"] }],
        });
        expect(localDatabase.getDBEntry).toHaveBeenCalledWith(documentPath, undefined, false, false);
        expect(localDatabase.putDBEntry).not.toHaveBeenCalled();
    });

    it("preserves the inherited transient empty-data hash while repairing a V1 document", async () => {
        const { dependencies, localDatabase, log } = createDependencies();
        const data = pluginData();
        localDatabase.getDBEntry.mockResolvedValue(loadedEntry(documentPath, JSON.stringify(data)));

        const result = await loadCustomisationDisplayData(dependencies, documentPath, codec);

        expect(result).toMatchObject({ files: [{ data: [digestHash([])] }] });
        expect(localDatabase.putDBEntry).toHaveBeenCalledOnce();
        const saving = localDatabase.putDBEntry.mock.calls[0][0] as { data: Blob };
        expect(await saving.data.text()).toContain(digestHash(["payload"]));
        expect(log).toHaveBeenCalledWith(
            `Digest created for ${documentPath} to improve checking`,
            LOG_LEVEL_VERBOSE,
            undefined
        );
    });

    it("returns false when a V1 document is absent", async () => {
        const { dependencies, localDatabase } = createDependencies();
        localDatabase.getDBEntry.mockResolvedValue(false);

        await expect(loadCustomisationDisplayData(dependencies, documentPath, codec)).resolves.toBe(false);
    });

    it("distinguishes an absent V2 entry from a non-note database entry", async () => {
        const { dependencies, localDatabase, log } = createDependencies();
        const path = "ix:device-a/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix;

        localDatabase.getDBEntry.mockResolvedValueOnce(false);
        await expect(loadCustomisationV2Entry(dependencies, path)).resolves.toBe(false);
        expect(log).toHaveBeenLastCalledWith(`The file ${path} is not found`, LOG_LEVEL_VERBOSE, undefined);

        localDatabase.getDBEntry.mockResolvedValueOnce({ path, type: "leaf" });
        await expect(loadCustomisationV2Entry(dependencies, path)).resolves.toBe(false);
        expect(log).toHaveBeenLastCalledWith(`The file ${path} is not a note`, LOG_LEVEL_VERBOSE, undefined);
    });

    it("returns a loaded V2 entry after the exact single-argument database lookup", async () => {
        const { dependencies, localDatabase } = createDependencies();
        const path = "ix:device-a/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix;
        const loaded = loadedEntry(path, "data");
        localDatabase.getDBEntry.mockResolvedValue(loaded);

        await expect(loadCustomisationV2Entry(dependencies, path)).resolves.toBe(loaded);
        expect(localDatabase.getDBEntry).toHaveBeenCalledWith(path);
    });

    it("decodes a V2 payload into its relative Customisation Sync filename", () => {
        const path = "ix:device-a/PLUGIN_MAIN/example%main.js" as FilePathWithPrefix;
        const loaded = loadedEntry(path, `${codec.dummyHead}${codec.dummyEnd}${btoa("console.log('example');")}`);

        expect(decodeCustomisationSyncV2File(path, loaded, codec.dummyEnd)).toEqual({
            confKey: "device-a/plugins/example",
            isManifest: false,
            file: {
                ...loaded,
                filename: "plugins/example/main.js",
                displayName: "main.js",
                hash: "",
                data: ["console.log('example');"],
            },
        });
    });

    it("preserves the inherited best-effort offset when a V2 marker is missing", () => {
        const path = "ix:device-a/CONFIG/app.json%app.json" as FilePathWithPrefix;
        const loaded = loadedEntry(path, `00${btoa("hello")}`);

        expect(decodeCustomisationSyncV2File(path, loaded, "END").file.data).toEqual(["hello"]);
    });
});
