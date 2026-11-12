import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { FilePathIndex, type FilePath, type PathComparisonSettings } from "@vrtmrz/livesync-commonlib/storage";
import { ObsidianFileSystemAdapter } from "./ObsidianFileSystemAdapter";

vi.mock("./ObsidianConversionAdapter", () => ({ ObsidianConversionAdapter: class {} }));
vi.mock("./ObsidianPathAdapter", () => ({ ObsidianPathAdapter: class {} }));
vi.mock("./ObsidianStorageAdapter", () => ({ ObsidianStorageAdapter: class {} }));
vi.mock("./ObsidianTypeGuardAdapter", () => ({ ObsidianTypeGuardAdapter: class {} }));
vi.mock("./ObsidianVaultAdapter", () => ({ ObsidianVaultAdapter: class {} }));
afterEach(() => vi.restoreAllMocks());

type VaultEvent = "create" | "delete" | "rename" | "modify";
type VaultEventHandler = (file: TAbstractFile, oldPath?: string) => void;
type TestFileNameLookup = {
    getFileNames(options?: { fresh?: boolean }): Promise<FilePath[]>;
    findPathIdentityCandidates(path: FilePath, policy: PathComparisonSettings): Promise<readonly FilePath[]>;
};

function makeFile(path: string): TFile {
    return { path } as TFile;
}

function makeFolder(path: string, children: TAbstractFile[] = []): TFolder {
    return { path, children } as TFolder;
}

function getLookup(adapter: ObsidianFileSystemAdapter): TestFileNameLookup | undefined {
    return (adapter as unknown as { fileNameLookup?: TestFileNameLookup }).fileNameLookup;
}

async function sortedFileNames(lookup: TestFileNameLookup): Promise<FilePath[]> {
    return (await lookup.getFileNames()).sort();
}

function makeApp(initialFiles: TFile[]) {
    const handlers = new Map<VaultEvent, VaultEventHandler[]>();
    const refs: object[] = [];
    const files = [...initialFiles];
    const on = vi.fn((event: VaultEvent, handler: VaultEventHandler) => {
        const eventHandlers = handlers.get(event) ?? [];
        eventHandlers.push(handler);
        handlers.set(event, eventHandlers);
        const ref = {};
        refs.push(ref);
        return ref;
    });
    const getFiles = vi.fn(() => [...files]);
    const offref = vi.fn();
    const app = {
        vault: {
            getFiles,
            on,
            offref,
        },
    } as unknown as App;

    return {
        app,
        files,
        handlers,
        on,
        offref,
        refs,
        getFiles,
        emit(event: VaultEvent, file: TAbstractFile, oldPath?: string) {
            for (const handler of handlers.get(event) ?? []) {
                handler(file, oldPath);
            }
        },
    };
}

describe("ObsidianFileSystemAdapter file-name lookup", () => {
    it("seeds the lookup from the Vault after registering direct membership listeners", async () => {
        const note = makeFile("notes/first.md");
        const mock = makeApp([note]);
        const adapter = new ObsidianFileSystemAdapter(mock.app);
        const lookup = getLookup(adapter);

        expect(lookup).toBeDefined();
        expect(mock.on.mock.calls.map(([event]) => event)).toEqual(["create", "delete", "rename"]);
        expect(mock.getFiles).toHaveBeenCalledTimes(1);
        expect(Math.max(...mock.on.mock.invocationCallOrder)).toBeLessThan(mock.getFiles.mock.invocationCallOrder[0]);
        expect(await sortedFileNames(lookup!)).toEqual(["notes/first.md"]);
    });

    it("updates file and folder membership before any synchronisation filtering, without rebuilding on content edits", async () => {
        const apply = vi.spyOn(FilePathIndex.prototype, "apply");
        const replaceAll = vi.spyOn(FilePathIndex.prototype, "replaceAll");
        const mock = makeApp([makeFile("notes/first.md"), makeFile("notes-old/keep.md")]);
        const adapter = new ObsidianFileSystemAdapter(mock.app);
        const lookup = getLookup(adapter);

        expect(lookup).toBeDefined();
        const initialEnumerationCount = mock.getFiles.mock.calls.length;
        expect(replaceAll).toHaveBeenCalledTimes(1);
        const added = makeFile("notes/second.md");
        mock.files.push(added);
        mock.emit("create", added);
        mock.emit("create", added);
        expect(await sortedFileNames(lookup!)).toEqual(["notes-old/keep.md", "notes/first.md", "notes/second.md"]);
        mock.emit("delete", added);
        expect(await sortedFileNames(lookup!)).toEqual(["notes-old/keep.md", "notes/first.md"]);
        mock.emit("create", added);
        mock.emit("create", added);
        expect(await sortedFileNames(lookup!)).toEqual(["notes-old/keep.md", "notes/first.md", "notes/second.md"]);
        added.path = "notes/renamed.md";
        mock.emit("rename", added, "notes/second.md");
        expect(await sortedFileNames(lookup!)).toEqual(["notes-old/keep.md", "notes/first.md", "notes/renamed.md"]);

        const applyCount = apply.mock.calls.length;
        const replaceAllCount = replaceAll.mock.calls.length;
        mock.emit("modify", added);
        expect(mock.getFiles).toHaveBeenCalledTimes(initialEnumerationCount);
        expect(apply).toHaveBeenCalledTimes(applyCount);
        expect(replaceAll).toHaveBeenCalledTimes(replaceAllCount);

        mock.files.push(makeFile("new-folder/nested.md"));
        mock.emit("create", makeFolder("new-folder"));
        expect(await sortedFileNames(lookup!)).toEqual([
            "new-folder/nested.md",
            "notes-old/keep.md",
            "notes/first.md",
            "notes/renamed.md",
        ]);

        const movedFolder = makeFolder("archive");
        mock.emit("rename", movedFolder, "notes");
        expect(await sortedFileNames(lookup!)).toEqual([
            "archive/first.md",
            "archive/renamed.md",
            "new-folder/nested.md",
            "notes-old/keep.md",
        ]);

        mock.emit("delete", makeFolder("archive"));
        expect(await sortedFileNames(lookup!)).toEqual(["new-folder/nested.md", "notes-old/keep.md"]);
    });

    it("uses the latest Vault listing for a fresh read and disposes only its own listeners", async () => {
        const mock = makeApp([makeFile("notes/first.md")]);
        const adapter = new ObsidianFileSystemAdapter(mock.app);
        const lookup = getLookup(adapter);

        expect(lookup).toBeDefined();
        mock.files.push(makeFile("notes/second.md"));
        expect([...(await lookup!.getFileNames({ fresh: true }))].sort()).toEqual([
            "notes/first.md",
            "notes/second.md",
        ]);
        expect(mock.getFiles).toHaveBeenCalledTimes(2);
        expect(await sortedFileNames(lookup!)).toEqual(["notes/first.md", "notes/second.md"]);

        const sourceRefs = mock.refs.slice();
        const unrelatedRef = mock.app.vault.on("modify", vi.fn());
        const offref = mock.offref;
        (adapter as unknown as { dispose: () => void }).dispose();
        const disposedRefs = offref.mock.calls.map(([ref]) => ref);
        expect(disposedRefs).toHaveLength(sourceRefs.length);
        expect(disposedRefs.every((ref, index) => ref === sourceRefs[index])).toBe(true);
        (adapter as unknown as { dispose: () => void }).dispose();
        expect(offref).toHaveBeenCalledTimes(sourceRefs.length);
        expect(disposedRefs.some((ref) => ref === unrelatedRef)).toBe(false);
        await expect(lookup!.getFileNames()).rejects.toThrow("disposed");
    });

    it("ignores late membership callbacks and rejects queries after disposal", async () => {
        const mock = makeApp([makeFile("note.md")]);
        const adapter = new ObsidianFileSystemAdapter(mock.app);
        const lookup = getLookup(adapter)!;
        const apply = vi.spyOn(FilePathIndex.prototype, "apply");
        adapter.dispose();

        // The host can already have captured a callback when listeners are removed.
        mock.emit("create", makeFolder("later"));
        mock.emit("delete", makeFile("note.md"));
        mock.emit("rename", makeFile("renamed.md"), "note.md");
        expect(apply).not.toHaveBeenCalled();
        expect(mock.getFiles).toHaveBeenCalledTimes(1);
        await expect(
            lookup.findPathIdentityCandidates("note.md" as FilePath, {
                pathNormalizationVersion: 0,
                handleFilenameCaseSensitive: true,
            })
        ).rejects.toThrow("disposed");
    });

    it("returns every equivalent original path under each supported comparison policy", async () => {
        const mock = makeApp([
            makeFile("notes/Café.md"),
            makeFile("notes/café.md"),
            makeFile("notes/Cafe\u0301.md"),
            makeFile("notes/cafe\u0301.md"),
        ]);
        const adapter = new ObsidianFileSystemAdapter(mock.app);
        const lookup = getLookup(adapter)!;
        const path = "notes/Café.md" as FilePath;
        const policies: [PathComparisonSettings, readonly string[]][] = [
            [{ pathNormalizationVersion: 0, handleFilenameCaseSensitive: true }, ["notes/Café.md"]],
            [{ pathNormalizationVersion: 0, handleFilenameCaseSensitive: false }, ["notes/Café.md", "notes/café.md"]],
            [
                { pathNormalizationVersion: 1, handleFilenameCaseSensitive: true },
                ["notes/Café.md", "notes/Cafe\u0301.md"],
            ],
            [
                { pathNormalizationVersion: 1, handleFilenameCaseSensitive: false },
                ["notes/Café.md", "notes/café.md", "notes/Cafe\u0301.md", "notes/cafe\u0301.md"],
            ],
        ];

        for (const [policy, expected] of policies) {
            const matches = await lookup.findPathIdentityCandidates(path, policy);
            expect([...matches].sort()).toEqual([...expected].sort());
        }
    });

    it("removes its listeners if the initial Vault listing fails", () => {
        const mock = makeApp([]);
        mock.getFiles.mockImplementation(() => {
            throw new Error("Vault listing failed");
        });

        expect(() => new ObsidianFileSystemAdapter(mock.app)).toThrow("Vault listing failed");
        expect(mock.offref.mock.calls.map(([ref]) => ref)).toEqual(mock.refs);
    });
});
