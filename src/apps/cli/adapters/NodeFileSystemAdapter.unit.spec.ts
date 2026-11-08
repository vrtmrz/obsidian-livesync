import { afterEach, describe, expect, it, vi } from "vitest";
import { fsPromises as fs, NodeStorageAdapter, os, path } from "@vrtmrz/livesync-commonlib/node";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { parseFilePath, type StoragePath } from "@vrtmrz/livesync-commonlib/storage";
import {
    ServiceRebuilder,
    type ServiceRebuilderDependencies,
} from "@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder";
import { PathServiceCompat } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectablePathService";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { AmbiguousNormalisedPathError } from "./UnicodeResolvingNodeStorageAdapter";
import { NodeFileSystemAdapter } from "./NodeFileSystemAdapter";

describe("NodeFileSystemAdapter file enumeration", () => {
    const tempDirs: string[] = [];
    const paths = ["a.md", "folder/b.md", "folder/sub/c.md"];

    async function createVault() {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-enumeration-"));
        tempDirs.push(directory);
        for (const file of paths) {
            await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
            await fs.writeFile(path.join(directory, file), `content of ${file}`);
        }
        return { directory, adapter: new NodeFileSystemAdapter(directory) };
    }

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
    });

    it.each([0, 1])("does not read hidden directories in identity mode %s", async (version) => {
        const { directory } = await createVault();
        for (const hiddenFile of [".tool/state/private.txt", "folder/.private/secret.md"]) {
            await fs.mkdir(path.dirname(path.join(directory, hiddenFile)), { recursive: true });
            await fs.writeFile(path.join(directory, hiddenFile), "excluded hidden content");
        }
        const report = vi.fn();
        const adapter = new NodeFileSystemAdapter(directory, report, () => version);
        const hiddenReads: string[] = [];
        const error = Object.assign(new Error("Hidden directory is unreadable"), { code: "EACCES" });
        const checkDirectory = (relativePath: string) => {
            if (relativePath === ".tool" || relativePath === "folder/.private") {
                hiddenReads.push(relativePath);
                throw error;
            }
        };
        const readDirectory = adapter.storage.readDirectory.bind(adapter.storage);
        vi.spyOn(adapter.storage, "readDirectory").mockImplementation(async (relativePath) => {
            checkDirectory(relativePath);
            return await readDirectory(relativePath);
        });
        const list = adapter.storage.list.bind(adapter.storage);
        vi.spyOn(adapter.storage, "list").mockImplementation(async (...args) => {
            checkDirectory(args[0]);
            return await list(...args);
        });

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
        await adapter.scanDirectory();
        await adapter.scanDirectory(".tool/state");
        expect(hiddenReads).toEqual([]);
        expect(report).not.toHaveBeenCalled();
    });

    it.each([0, 1])("keeps explicit hidden file lookups available in identity mode %s", async (version) => {
        const { directory } = await createVault();
        const hiddenPath = ".tool/state/private.txt";
        await fs.mkdir(path.dirname(path.join(directory, hiddenPath)), { recursive: true });
        await fs.writeFile(path.join(directory, hiddenPath), "explicit hidden content");
        const adapter = new NodeFileSystemAdapter(directory, undefined, () => version);

        expect(await adapter.getAbstractFileByPath(hiddenPath)).toMatchObject({ path: hiddenPath });
        expect(await adapter.storage.read(hiddenPath)).toBe(
            "explicit hidden content"
        );
    });

    it("lists every file when one file was refreshed before the first enumeration", async () => {
        const { adapter } = await createVault();

        expect(await adapter.refreshFile("folder/b.md")).not.toBeNull();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
    });

    it("lists every file after a path lookup without any replication", async () => {
        const { adapter } = await createVault();

        expect((await adapter.getAbstractFileByPath("folder/b.md"))?.path).toBe("folder/b.md");

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
    });

    it("lists every file on the first enumeration without a prior path lookup", async () => {
        const { adapter } = await createVault();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
    });

    it.skipIf(process.platform === "win32")(
        "compatibility: lists other files in Legacy mode when one root name is unsupported",
        async () => {
            const { directory, adapter } = await createVault();
            await fs.writeFile(path.join(directory, "a:unrelated.md"), "unrelated local bytes");

            expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);
            expect(await fs.readFile(path.join(directory, "a:unrelated.md"), "utf8")).toBe("unrelated local bytes");
        }
    );

    it("excludes a deleted file after its cache entry is refreshed", async () => {
        const { directory, adapter } = await createVault();
        await adapter.getFiles();

        await fs.rm(path.join(directory, "folder/b.md"));
        expect(await adapter.refreshFile("folder/b.md")).toBeNull();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(["a.md", "folder/sub/c.md"]);
    });

    it("reflects files added and deleted between enumerations", async () => {
        const { directory, adapter } = await createVault();

        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(paths);

        await fs.rm(path.join(directory, "folder/b.md"));
        const updatedContent = "updated content of a.md";
        await fs.writeFile(path.join(directory, "a.md"), updatedContent);
        await fs.writeFile(path.join(directory, "later.md"), "content of later.md");

        const files = await adapter.getFiles();
        expect(files.map((file) => file.path).sort()).toEqual(["a.md", "folder/sub/c.md", "later.md"]);
        expect(files.find((file) => file.path === "a.md")?.stat.size).toBe(updatedContent.length);
    });

    it("returns complete listings from simultaneous calls", async () => {
        const { adapter } = await createVault();

        const originalStat = adapter.storage.stat.bind(adapter.storage);
        let releaseFolderStat!: () => void;
        const folderStatReleased = new Promise<void>((resolve) => {
            releaseFolderStat = resolve;
        });
        let folderStatStarted!: () => void;
        const folderStatStartedPromise = new Promise<void>((resolve) => {
            folderStatStarted = resolve;
        });
        let pauseFolderStat = true;
        const statSpy = vi.spyOn(adapter.storage, "stat").mockImplementation(async (relativePath) => {
            const stat = await originalStat(relativePath);
            if (pauseFolderStat && relativePath === "folder") {
                pauseFolderStat = false;
                folderStatStarted();
                await folderStatReleased;
            }
            return stat;
        });

        const firstListing = adapter.getFiles();
        let listings: Awaited<ReturnType<typeof adapter.getFiles>>[] | undefined;
        try {
            await folderStatStartedPromise;
            const secondListing = adapter.getFiles();
            const secondFiles = await secondListing;
            releaseFolderStat();
            const firstFiles = await firstListing;
            listings = [secondFiles, firstFiles];
        } finally {
            releaseFolderStat();
            statSpy.mockRestore();
        }

        if (!listings) throw new Error("Expected both concurrent listings to complete");
        expect(listings.map((files) => files.map((file) => file.path).sort())).toEqual([paths, paths]);
    });

    it("returns an empty listing for an empty vault", async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-enumeration-empty-"));
        tempDirs.push(directory);
        const adapter = new NodeFileSystemAdapter(directory);

        await expect(adapter.getFiles()).resolves.toEqual([]);
    });
});

describe("NodeFileSystemAdapter case-insensitive path lookup", () => {
    const tempDirs: string[] = [];

    async function createVault(files: string[] = []) {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-insensitive-"));
        tempDirs.push(directory);
        for (const file of files) {
            await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
            await fs.writeFile(path.join(directory, file), `content of ${file}`);
        }
        return { directory, adapter: new NodeFileSystemAdapter(directory) };
    }

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
    });

    it("returns an exact path without scanning the directory", async () => {
        const { adapter } = await createVault(["Calculus.md"]);
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("Calculus.md")).resolves.toMatchObject({
            path: "Calculus.md",
        });

        expect(scanDirectory).not.toHaveBeenCalled();
    });

    it("returns a cached case-insensitive match without rescanning", async () => {
        const { adapter } = await createVault(["Calculus.md"]);
        await adapter.scanDirectory();
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("calculus.md")).resolves.toMatchObject({
            path: "Calculus.md",
        });

        expect(scanDirectory).not.toHaveBeenCalled();
    });

    it("rescans once and returns a newly cached case-insensitive match", async () => {
        const { adapter } = await createVault(["Calculus.md"]);
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("calculus.md")).resolves.toMatchObject({
            path: "Calculus.md",
        });

        expect(scanDirectory).toHaveBeenCalledOnce();
        await expect(adapter.getAbstractFileByPath("Calculus.md")).resolves.toMatchObject({ path: "Calculus.md" });
    });

    it("returns null after one scan when no cached path matches", async () => {
        const { adapter } = await createVault(["other.md"]);
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("missing.md")).resolves.toBeNull();

        expect(scanDirectory).toHaveBeenCalledOnce();
    });

    it("returns null and reports a directory scan failure", async () => {
        const missingDirectory = path.join(os.tmpdir(), `livesync-cli-insensitive-missing-${Date.now()}`);
        const reportDiagnostic = vi.fn();
        const adapter = new NodeFileSystemAdapter(missingDirectory, reportDiagnostic);
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");

        await expect(adapter.getAbstractFileByPathInsensitive("missing.md")).resolves.toBeNull();

        expect(scanDirectory).toHaveBeenCalledOnce();
        expect(reportDiagnostic).toHaveBeenCalledWith(
            expect.stringContaining("Error scanning directory"),
            expect.any(Error)
        );
    });
});

describe("NodeFileSystemAdapter Unicode path resolution", () => {
    const tempDirs: string[] = [];

    async function createVault() {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "livesync-cli-unicode-"));
        tempDirs.push(directory);
        return directory;
    }

    function createNormalisingAdapter(directory: string, caseInsensitive = false) {
        return new NodeFileSystemAdapter(
            directory,
            undefined,
            () => 1,
            () => caseInsensitive
        );
    }

    it("propagates path-resolution failures when refreshing a file", async () => {
        const directory = await createVault();
        const adapter = createNormalisingAdapter(directory);
        const error = Object.assign(new Error("Storage permission denied"), { code: "EACCES" });
        vi.spyOn(adapter.storage, "resolveLogicalPath").mockRejectedValue(error);

        await expect(adapter.refreshFile("a.md")).rejects.toBe(error);
    });

    it("propagates strict metadata failures when refreshing a resolved file", async () => {
        const directory = await createVault();
        await fs.writeFile(path.join(directory, "a.md"), "content");
        const adapter = createNormalisingAdapter(directory);
        const error = Object.assign(new Error("Storage permission denied"), { code: "EACCES" });
        vi.spyOn(adapter.storage, "statResolved").mockRejectedValue(error);

        await expect(adapter.getAbstractFileByPath("a.md")).rejects.toBe(error);
    });

    it("keeps resolved metadata reads strict when the identity mode changes during lookup", async () => {
        const directory = await createVault();
        await fs.writeFile(path.join(directory, "a.md"), "content");
        let version = 1;
        const adapter = new NodeFileSystemAdapter(directory, undefined, () => version);
        const error = Object.assign(new Error("Storage permission denied"), { code: "EACCES" });
        const resolve = adapter.storage.resolveLogicalPath.bind(adapter.storage);
        vi.spyOn(adapter.storage, "resolveLogicalPath").mockImplementation(async (...args) => {
            const result = await resolve(...args);
            version = 0;
            return result;
        });
        vi.spyOn(adapter.storage, "statResolved").mockRejectedValue(error);

        await expect(adapter.getAbstractFileByPath("a.md")).rejects.toBe(error);
    });

    it("propagates strict directory-read failures without reporting an incomplete scan", async () => {
        const directory = await createVault();
        const report = vi.fn();
        const adapter = new NodeFileSystemAdapter(directory, report, () => 1);
        const error = Object.assign(new Error("Storage permission denied"), { code: "EACCES" });
        vi.spyOn(adapter.storage, "readDirectory").mockRejectedValue(error);

        await expect(adapter.getFiles()).rejects.toBe(error);
        expect(report).not.toHaveBeenCalled();
    });

    it("does not return or cache a partial NFC listing after a nested directory read fails", async () => {
        const directory = await createVault();
        const knownPath = "Known.md";
        const initialContent = "initial content";
        await fs.writeFile(path.join(directory, knownPath), initialContent);
        let normalizationVersion = 1;
        const adapter = new NodeFileSystemAdapter(directory, undefined, () => normalizationVersion, () => true);
        await adapter.scanDirectory();

        const changedContent = "changed content after cache";
        await fs.writeFile(path.join(directory, knownPath), changedContent);
        await fs.mkdir(path.join(directory, "late-directory"));
        await fs.writeFile(path.join(directory, "late-directory", "later.md"), "later content");

        const error = Object.assign(new Error("Storage permission denied"), { code: "EACCES" });
        const readDirectory = adapter.storage.readDirectory.bind(adapter.storage);
        const readDirectorySpy = vi.spyOn(adapter.storage, "readDirectory").mockImplementation(async (relativePath) => {
            if (relativePath === "late-directory") throw error;
            const entries = await readDirectory(relativePath);
            return relativePath === "" && entries !== null
                ? [...entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
                : entries;
        });

        try {
            await expect(adapter.getFiles()).rejects.toBe(error);
            await expect(adapter.scanDirectory()).rejects.toBe(error);
        } finally {
            readDirectorySpy.mockRestore();
        }

        // Compatibility-mode case-insensitive lookup exposes the cache without
        // triggering another scan, so it can verify that the failed NFC scan did
        // not publish its already-enumerated file metadata.
        normalizationVersion = 0;
        const scanDirectory = vi.spyOn(adapter, "scanDirectory");
        await expect(adapter.getAbstractFileByPathInsensitive("known.md")).resolves.toMatchObject({
            path: knownPath,
            stat: { size: initialContent.length },
        });
        expect(scanDirectory).not.toHaveBeenCalled();
    });

    it("uses one comparison policy snapshot for the whole NFC scan", async () => {
        const directory = await createVault();
        await fs.mkdir(path.join(directory, "Folder"));
        await fs.writeFile(path.join(directory, "Folder/Note.md"), "upper");
        await fs.writeFile(path.join(directory, "Folder/note.md"), "lower");
        let policyReads = 0;
        let normalizationReads = 0;
        const adapter = new NodeFileSystemAdapter(
            directory,
            undefined,
            () => {
                normalizationReads++;
                return 1;
            },
            () => ++policyReads > 1
        );

        const files = await adapter.getFiles();

        expect(files.map((file) => file.path).sort()).toEqual(["Folder/Note.md", "Folder/note.md"]);
        expect(normalizationReads).toBe(1);
        expect(policyReads).toBe(1);
    });

    afterEach(async () => {
        await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
    });

    it.each([0, 1])("keeps an NFD-only file in the storage listing in identity mode %s", async (version) => {
        const directory = await createVault();
        const originalPath = "café.md".normalize("NFD");
        await fs.writeFile(path.join(directory, originalPath), "original");
        const report = vi.fn();
        const adapter = new NodeFileSystemAdapter(directory, report, () => version);

        expect((await adapter.getFiles()).map((file) => file.path)).toEqual([originalPath]);
        expect(report).not.toHaveBeenCalled();
        await expect(fs.readFile(path.join(directory, originalPath), "utf8")).resolves.toBe("original");
        expect(await fs.readdir(directory)).toEqual([originalPath]);
    });

    it.each([false, true])(
        "enumerates nested mixed names once per directory with case-insensitive matching %s",
        async (caseInsensitive) => {
            const directory = await createVault();
            const parent = "café".normalize("NFD");
            const child = `${parent}/Étage`;
            await fs.mkdir(path.join(directory, child), { recursive: true });
            const names = Array.from(
                { length: 12 },
                (_, index) =>
                    `${child}/${index}-résumé.md`
                        .normalize(index % 2 ? "NFC" : "NFD")
                        .split("/")
                        .pop()!
            );
            for (const name of names) await fs.writeFile(path.join(directory, child, name), "content");
            const adapter = createNormalisingAdapter(directory, caseInsensitive);
            const readDirectory = vi.spyOn(NodeStorageAdapter.prototype, "readDirectory");
            try {
                const files = await adapter.getFiles();
                expect(files.map((file) => file.path).sort()).toEqual(names.map((name) => `${child}/${name}`).sort());
                expect(readDirectory).toHaveBeenCalledTimes(3);
            } finally {
                readDirectory.mockRestore();
            }
        }
    );

    it("uses the existing mixed parent during directory preparation and preserves the new leaf spelling", async () => {
        const directory = await createVault();
        const parent = "café".normalize("NFD");
        const child = `${parent}/Étage`;
        await fs.mkdir(path.join(directory, child), { recursive: true });
        const adapter = createNormalisingAdapter(directory);
        await adapter.storage.mkdir("café");
        await adapter.storage.mkdir("café/Étage");
        const newName = "résumé.md".normalize("NFD");
        const file = await adapter.vault.create(`café/Étage/${newName}`, "created");

        expect(file.path).toBe(`${child}/${newName}`);
        expect(await fs.readdir(directory)).toEqual([parent]);
        expect(await fs.readdir(path.join(directory, parent))).toEqual(["Étage"]);
        expect(await fs.readdir(path.join(directory, child))).toEqual([newName]);
        await expect(adapter.storage.stat(`café/Étage/${newName.normalize("NFC")}`)).resolves.toMatchObject({
            size: 7,
        });
    });

    it("rejects an NFC-equivalent file and directory before scanning or writing a child", async () => {
        const directory = await createVault();
        const composed = "café";
        const decomposed = composed.normalize("NFD");
        await fs.writeFile(path.join(directory, composed), "file");
        await fs.mkdir(path.join(directory, decomposed));
        const adapter = createNormalisingAdapter(directory);

        await expect(adapter.getFiles()).rejects.toThrow(/ambiguous/i);
        await expect(adapter.storage.write(`${composed}/new.md`, "new")).rejects.toThrow(/ambiguous/i);
        await expect(fs.readFile(path.join(directory, composed), "utf8")).resolves.toBe("file");
        expect(await fs.readdir(path.join(directory, decomposed))).toEqual([]);
    });

    it.each([false, true])(
        "enumerates each directory once for a flat NFC scan with case-insensitive matching %s",
        async (caseInsensitive) => {
            const directory = await createVault();
            for (let index = 0; index < 12; index++) {
                await fs.writeFile(path.join(directory, `${index}.md`), "content");
            }
            const adapter = createNormalisingAdapter(directory, caseInsensitive);
            const readDirectory = vi.spyOn(NodeStorageAdapter.prototype, "readDirectory");
            try {
                expect(await adapter.getFiles()).toHaveLength(12);
                expect(readDirectory).toHaveBeenCalledTimes(1);
            } finally {
                readDirectory.mockRestore();
            }
        }
    );

    it("reads, updates, and deletes an NFD file through its NFC path", async () => {
        const directory = await createVault();
        const nfcFolder = "café";
        const nfdFolder = nfcFolder.normalize("NFD");
        const nfcName = "Ångström.md";
        const nfdName = nfcName.normalize("NFD");
        await fs.mkdir(path.join(directory, nfdFolder));
        await fs.writeFile(path.join(directory, nfdFolder, nfdName), "before", "utf8");
        const adapter = createNormalisingAdapter(directory);

        const file = await adapter.getAbstractFileByPath(`${nfcFolder}/${nfcName}`);
        expect(file?.path).toBe(`${nfdFolder}/${nfdName}`);
        if (!file) throw new Error("Expected the NFC path to resolve to the NFD file");
        await expect(adapter.vault.read(file)).resolves.toBe("before");
        await adapter.vault.modify(file, "after");
        await expect(fs.readFile(path.join(directory, nfdFolder, nfdName), "utf8")).resolves.toBe("after");
        expect(await fs.readdir(directory)).toEqual([nfdFolder]);
        expect(await fs.readdir(path.join(directory, nfdFolder))).toEqual([nfdName]);

        await adapter.vault.delete(file);

        await expect(fs.readdir(path.join(directory, nfdFolder))).resolves.toEqual([]);
    });

    it("creates a new file inside an existing NFD directory using that directory spelling", async () => {
        const directory = await createVault();
        const nfdFolder = "café".normalize("NFD");
        await fs.mkdir(path.join(directory, nfdFolder));
        const adapter = createNormalisingAdapter(directory);

        const file = await adapter.vault.create("café/new.md", "content");

        expect(file.path).toBe(`${nfdFolder}/new.md`);
        await expect(fs.readFile(path.join(directory, nfdFolder, "new.md"), "utf8")).resolves.toBe("content");
        expect(await fs.readdir(directory)).toEqual([nfdFolder]);
    });

    it("renames a file by case inside an NFD directory while preserving that directory spelling", async () => {
        const directory = await createVault();
        const nfcFolder = "Caf\u00e9";
        const nfdFolder = nfcFolder.normalize("NFD");
        await fs.mkdir(path.join(directory, nfdFolder));
        await fs.writeFile(path.join(directory, nfdFolder, "Note.md"), "content", "utf8");
        const adapter = createNormalisingAdapter(directory, true);
        const file = await adapter.getAbstractFileByPathInsensitive(`${nfcFolder}/Note.md`);
        if (!file) throw new Error("Expected the NFC path to resolve to the NFD file");

        const renamedFile = await adapter.renameFile(file, `${nfcFolder}/note.md`);

        expect(renamedFile.path).toBe(`${nfdFolder}/note.md`);
        expect(await fs.readdir(directory)).toEqual([nfdFolder]);
        await expect(fs.readdir(path.join(directory, nfdFolder))).resolves.toEqual(["note.md"]);
        await expect(fs.readFile(path.join(directory, nfdFolder, "note.md"), "utf8")).resolves.toBe("content");
    });

    it("rejects an NFC/NFD file collision for lookup and vault mutations", async () => {
        const directory = await createVault();
        const nfcName = "café.md";
        const nfdName = nfcName.normalize("NFD");
        await fs.writeFile(path.join(directory, nfcName), "NFC", "utf8");
        await fs.writeFile(path.join(directory, nfdName), "NFD", "utf8");
        const adapter = createNormalisingAdapter(directory);
        const exactFile = {
            path: parseFilePath(nfcName),
            stat: { ctime: 1, mtime: 2, size: 3, type: "file" as const },
        };

        await expect(adapter.getAbstractFileByPath(nfcName)).rejects.toBeInstanceOf(AmbiguousNormalisedPathError);
        await expect(adapter.vault.modify(exactFile, "changed")).rejects.toThrow(/ambiguous/i);
        await expect(adapter.vault.delete(exactFile)).rejects.toThrow(/ambiguous/i);

        await expect(fs.readFile(path.join(directory, nfcName), "utf8")).resolves.toBe("NFC");
        await expect(fs.readFile(path.join(directory, nfdName), "utf8")).resolves.toBe("NFD");
        expect((await fs.readdir(directory)).sort()).toEqual([nfcName, nfdName].sort());
    });

    it("rejects an NFC/NFD directory collision before creating a child", async () => {
        const directory = await createVault();
        const nfcFolder = "café";
        const nfdFolder = nfcFolder.normalize("NFD");
        await fs.mkdir(path.join(directory, nfcFolder));
        await fs.mkdir(path.join(directory, nfdFolder));
        await fs.writeFile(path.join(directory, nfcFolder, "inside.md"), "NFC", "utf8");
        await fs.writeFile(path.join(directory, nfdFolder, "inside.md"), "NFD", "utf8");
        const adapter = createNormalisingAdapter(directory);

        await expect(adapter.getAbstractFileByPath(`${nfcFolder}/inside.md`)).rejects.toThrow(/ambiguous/i);
        await expect(adapter.storage.write(`${nfcFolder}/created.md`, "created")).rejects.toThrow(/ambiguous/i);

        await expect(fs.readdir(path.join(directory, nfcFolder))).resolves.toEqual(["inside.md"]);
        await expect(fs.readdir(path.join(directory, nfdFolder))).resolves.toEqual(["inside.md"]);
        await expect(fs.readFile(path.join(directory, nfcFolder, "inside.md"), "utf8")).resolves.toBe("NFC");
        await expect(fs.readFile(path.join(directory, nfdFolder, "inside.md"), "utf8")).resolves.toBe("NFD");
    });

    it("rejects enumeration when NFC-equivalent directories contain different files", async () => {
        const directory = await createVault();
        const nfcFolder = "café";
        const nfdFolder = nfcFolder.normalize("NFD");
        await fs.mkdir(path.join(directory, nfcFolder));
        await fs.mkdir(path.join(directory, nfdFolder));
        await fs.writeFile(path.join(directory, nfcFolder, "a.md"), "NFC", "utf8");
        await fs.writeFile(path.join(directory, nfdFolder, "b.md"), "NFD", "utf8");
        const adapter = createNormalisingAdapter(directory);

        await expect(adapter.getFiles()).rejects.toThrow(/ambiguous/i);
        await expect(adapter.scanDirectory()).rejects.toThrow(/ambiguous/i);

        await expect(fs.readFile(path.join(directory, nfcFolder, "a.md"), "utf8")).resolves.toBe("NFC");
        await expect(fs.readFile(path.join(directory, nfdFolder, "b.md"), "utf8")).resolves.toBe("NFD");
    });

    it("rechecks the directory after a unique file is cached", async () => {
        const directory = await createVault();
        const nfcName = "café.md";
        const nfdName = nfcName.normalize("NFD");
        await fs.writeFile(path.join(directory, nfdName), "NFD", "utf8");
        const adapter = createNormalisingAdapter(directory);

        await expect(adapter.getAbstractFileByPath(nfcName)).resolves.toMatchObject({ path: nfdName });
        await fs.writeFile(path.join(directory, nfcName), "NFC", "utf8");

        await expect(adapter.getAbstractFileByPath(nfcName)).rejects.toThrow(/ambiguous/i);
        await expect(fs.readFile(path.join(directory, nfcName), "utf8")).resolves.toBe("NFC");
        await expect(fs.readFile(path.join(directory, nfdName), "utf8")).resolves.toBe("NFD");
    });

    it.each([
        ["Foo", "foo"],
        ["Café", "café".normalize("NFD")],
    ])("rejects case-insensitive parent aliases %s and %s containing different files", async (first, second) => {
        const directory = await createVault();
        for (const [parent, name] of [
            [first, "one.md"],
            [second, "two.md"],
        ]) {
            await fs.mkdir(path.join(directory, parent));
            await fs.writeFile(path.join(directory, parent, name), name);
        }
        const adapter = createNormalisingAdapter(directory, true);

        await expect(adapter.getFiles()).rejects.toThrow(/ambiguous/i);
        await expect(adapter.scanDirectory()).rejects.toThrow(/ambiguous/i);
        await expect(fs.readFile(path.join(directory, first, "one.md"), "utf8")).resolves.toBe("one.md");
        await expect(fs.readFile(path.join(directory, second, "two.md"), "utf8")).resolves.toBe("two.md");
    });

    it.each([
        { version: 0, caseInsensitive: true },
        { version: 1, caseInsensitive: false },
    ])(
        "compatibility: retains distinct case paths in mode $version with case-insensitive matching $caseInsensitive",
        async ({ version, caseInsensitive }) => {
            const directory = await createVault();
            const names = ["Café/one.md", "café/two.md".normalize("NFD")];
            for (const name of names) {
                await fs.mkdir(path.dirname(path.join(directory, name)));
                await fs.writeFile(path.join(directory, name), name);
            }
            const adapter = new NodeFileSystemAdapter(
                directory,
                undefined,
                () => version,
                () => caseInsensitive
            );

            expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual([...names].sort());
            for (const name of names) await expect(adapter.storage.read(name)).resolves.toBe(name);
        }
    );

    it("refuses reconstruction before starting remote activity when parent aliases are ambiguous", async () => {
        const directory = await createVault();
        for (const name of ["Café/one.md", "café/two.md".normalize("NFD")]) {
            await fs.mkdir(path.dirname(path.join(directory, name)));
            await fs.writeFile(path.join(directory, name), name);
        }
        const adapter = createNormalisingAdapter(directory, true);
        const settings = {
            ...DEFAULT_SETTINGS,
            pathNormalizationVersion: 1 as const,
            handleFilenameCaseSensitive: false,
        };
        const setting = { currentSettings: () => settings, suspendAllSync: { addHandler: vi.fn() } };
        const runBoundedRemoteActivity = vi.fn(async () => undefined);
        const rebuilder = new ServiceRebuilder({
            setting,
            storageAccess: { getFileNames: async () => (await adapter.getFiles()).map((file) => file.path) },
            database: {
                onDatabaseReset: { addHandler: vi.fn() },
                isDatabaseReady: () => true,
                localDatabase: { findAllDocs: async function* () {} },
            },
            vault: { isTargetFile: async () => true },
            path: new PathServiceCompat(new ServiceContext(), { settingService: setting as never }),
            replicator: { runBoundedRemoteActivity },
            UI: { showMarkdownDialog: vi.fn(async () => undefined) },
        } as unknown as ServiceRebuilderDependencies);

        await expect(rebuilder.$rebuildEverything()).rejects.toThrow(/ambiguous/i);
        expect(runBoundedRemoteActivity).not.toHaveBeenCalled();
    });

    it("uses fresh listings after external additions, renames, deletions, and collisions", async () => {
        const directory = await createVault();
        const nfdName = "café.md".normalize("NFD");
        await fs.writeFile(path.join(directory, nfdName), "original");
        const adapter = createNormalisingAdapter(directory);
        expect((await adapter.getFiles()).map((file) => file.path)).toEqual([nfdName]);

        const renamed = "résumé.md".normalize("NFD");
        await fs.rename(path.join(directory, nfdName), path.join(directory, renamed));
        await fs.writeFile(path.join(directory, "new.md"), "new");
        expect((await adapter.getFiles()).map((file) => file.path).sort()).toEqual(["new.md", renamed]);

        await fs.rm(path.join(directory, "new.md"));
        expect((await adapter.getFiles()).map((file) => file.path)).toEqual([renamed]);
        await fs.writeFile(path.join(directory, renamed.normalize("NFC")), "collision");
        await expect(adapter.getFiles()).rejects.toThrow(/ambiguous/i);
    });

    it("retains the storage boundary for exact metadata reads and directory scans", async () => {
        const directory = await createVault();
        const outside = await createVault();
        await fs.writeFile(path.join(outside, "note.md"), "outside");
        await fs.symlink(outside, path.join(directory, "linked"), "dir");
        const adapter = createNormalisingAdapter(directory);

        await expect(adapter.getFiles()).resolves.toEqual([]);
        await expect(adapter.storage.resolveLogicalPath(parseFilePath("linked/note.md"))).rejects.toThrow(/symbolic links/i);
        await expect(adapter.storage.statExact("linked/note.md" as StoragePath)).rejects.toThrow(/symbolic links/i);
        await expect(adapter.storage.write("linked/note.md", "changed")).rejects.toThrow(/symbolic links/i);
        await expect(fs.readFile(path.join(outside, "note.md"), "utf8")).resolves.toBe("outside");
    });

    it("detects NFC and case collisions when lookup is case-insensitive", async () => {
        const directory = await createVault();
        const upperName = "Café.md";
        const lowerNfdName = "café.md".normalize("NFD");
        await fs.writeFile(path.join(directory, upperName), "upper", "utf8");
        await fs.writeFile(path.join(directory, lowerNfdName), "lower", "utf8");
        const adapter = createNormalisingAdapter(directory, true);

        await expect(adapter.getAbstractFileByPathInsensitive("CAFÉ.md")).rejects.toThrow(/ambiguous/i);
        await expect(adapter.getFiles()).rejects.toThrow(/ambiguous/i);
        await expect(adapter.scanDirectory()).rejects.toThrow(/ambiguous/i);
        await expect(fs.readFile(path.join(directory, upperName), "utf8")).resolves.toBe("upper");
        await expect(fs.readFile(path.join(directory, lowerNfdName), "utf8")).resolves.toBe("lower");
    });

    it("retains exact-path behaviour when path normalisation is disabled", async () => {
        const directory = await createVault();
        const nfcName = "café.md";
        const nfdName = nfcName.normalize("NFD");
        await fs.writeFile(path.join(directory, nfdName), "NFD", "utf8");
        const adapter = new NodeFileSystemAdapter(directory);

        await expect(adapter.getAbstractFileByPath(nfcName)).resolves.toBeNull();
        await adapter.storage.write(nfcName, "NFC");

        await expect(fs.readFile(path.join(directory, nfcName), "utf8")).resolves.toBe("NFC");
        await expect(fs.readFile(path.join(directory, nfdName), "utf8")).resolves.toBe("NFD");
    });
});
