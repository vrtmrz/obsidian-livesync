import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StorageAccessManager } from "@vrtmrz/livesync-commonlib/compat/managers/StorageProcessingManager";
import type { FileAccessBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase";
import { FilePathIndex, parseFilePath } from "@vrtmrz/livesync-commonlib/storage";
import { isAcceptedInFilenameDuplicationFactory } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/targetFilter";
import { FileAccessCLI } from "./FileAccessCLI";
import { ServiceFileAccessCLI } from "./ServiceFileAccessImpl";

const roots: string[] = [];
const accesses: FileAccessCLI[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
        accesses.splice(0).map(async (access) => {
            await access.fileNameSource?.close();
        })
    );
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(version: 0 | 1, caseSensitive: boolean, watching = true) {
    const root = await mkdtemp(join(tmpdir(), "livesync-name-query-"));
    roots.push(root);
    await mkdir(join(root, "unrelated"));
    await writeFile(join(root, "note.md"), "original");
    await writeFile(join(root, "unrelated", "other.md"), "other");
    const settings = { pathNormalizationVersion: version, handleFilenameCaseSensitive: caseSensitive };
    const dependencies = {
        storageAccessManager: new StorageAccessManager(),
        vaultService: { isStorageInsensitive: () => false },
        settingService: { currentSettings: () => settings },
        APIService: { addLog: vi.fn() },
        pathService: {},
    } as unknown as FileAccessBaseDependencies;
    const access = new FileAccessCLI(root, dependencies, watching ? {} : undefined);
    accesses.push(access);
    await access.fileNameSource?.prepare();
    const on = { addHandler: vi.fn() };
    const processing = { totalStorageFileEventCount: 0, commitPendingFileEvents: on };
    const storage = new ServiceFileAccessCLI({
        API: dependencies.APIService,
        vault: dependencies.vaultService,
        setting: dependencies.settingService,
        fileProcessing: processing,
        vaultAccess: access,
        storageEventManager: {},
        appLifecycle: { onFirstInitialise: on, onBeforeUnload: on },
    } as unknown as ConstructorParameters<typeof ServiceFileAccessCLI>[0]);
    const host = {
        services: {
            setting: dependencies.settingService,
            vault: { shouldCheckCaseInsensitively: () => !caseSensitive },
            fileProcessing: processing,
        },
        serviceModules: { storageAccess: storage },
    } as unknown as Parameters<typeof isAcceptedInFilenameDuplicationFactory>[0];
    const filter = isAcceptedInFilenameDuplicationFactory(host, vi.fn());
    return { root, access, storage, processing, filter };
}

describe("CLI watched names through shared storage access", () => {
    it.each([
        [0, true],
        [0, false],
        [1, true],
        [1, false],
    ] as const)(
        "does not enumerate metadata or rebuild identity maps after a content edit (version %i, case %s)",
        async (version, sensitive) => {
            const { access, storage, processing, filter } = await fixture(version, sensitive);
            const path = parseFilePath("note.md");
            expect(await filter(path)).toBe(true);
            const metadata = vi.spyOn(access.nodeAdapter, "getFiles");
            const rebuild = vi.spyOn(FilePathIndex.prototype, "replaceAll");
            const directories = vi.spyOn(access.nodeAdapter.storage, "readDirectory");
            await access.adapterWrite(path, "changed content");
            processing.totalStorageFileEventCount++;
            expect(await filter(path)).toBe(true);
            expect(metadata).not.toHaveBeenCalled();
            expect(rebuild).not.toHaveBeenCalled();
            expect(directories.mock.calls.every(([directory]) => directory !== "unrelated")).toBe(true);
            expect(await storage.getFileNames()).toEqual(expect.arrayContaining(["note.md", "unrelated/other.md"]));
            const files = await storage.getFiles();
            expect(files.find((file) => file.path === path)?.stat?.size).toBe("changed content".length);
        }
    );

    it("sees direct adapter creation and an external alias before delayed watch delivery", async () => {
        const { root, access, storage, filter } = await fixture(0, false);
        await access.adapterWrite("created.bin", new Uint8Array([1, 2, 3]));
        expect(await storage.getFileNames()).toContain("created.bin");
        await writeFile(join(root, "NOTE.MD"), "external alias");
        expect(await filter(parseFilePath("note.md"))).toBe(false);
        expect(await readFile(join(root, "note.md"), "utf8")).toBe("original");
        expect(await readFile(join(root, "NOTE.MD"), "utf8")).toBe("external alias");
        await access.adapterRemove("created.bin");
        expect(await storage.getFileNames()).not.toContain("created.bin");
    });

    it("reflects direct append and directory creation plus Vault rename before watch delivery", async () => {
        const { root, access, storage } = await fixture(0, true);
        await access.ensureDirectory("notes/later.md");
        await access.adapterAppend("notes/later.md", "appended");
        expect(await storage.getFileNames()).toContain("notes/later.md");
        await access.ensureDirectory("archive/renamed.md");
        const file = await access.getAbstractFileByPath("notes/later.md");
        if (!access.isFile(file)) {
            throw new Error("Expected the appended file");
        }
        await access.vaultRename(file, "archive/renamed.md");
        const names = await storage.getFileNames();
        expect(names).not.toContain("notes/later.md");
        expect(names).toContain("archive/renamed.md");
        expect(await readFile(join(root, "archive/renamed.md"), "utf8")).toBe("appended");
    });

    it("keeps non-watching commands on fresh metadata enumeration without creating a source", async () => {
        const { root, access, storage } = await fixture(0, true, false);
        expect(access.fileNameSource).toBeUndefined();
        expect(access.nodeAdapter.fileNameLookup).toBeUndefined();
        await writeFile(join(root, "later.md"), "later");
        expect(await storage.getFileNames({ fresh: true })).toContain("later.md");
        await access.adapterWrite("local.md", "local write");
        expect(await storage.getFileNames()).toContain("local.md");
        expect(await readFile(join(root, "local.md"), "utf8")).toBe("local write");
    });
});
