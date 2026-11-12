import { EventEmitter } from "node:events";
import { fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { parseFilePath, type PathComparisonSettings } from "@vrtmrz/livesync-commonlib/storage";
import type { FSWatcher } from "chokidar";
import { describe, expect, it, vi } from "vitest";
import { NodeFileSystemAdapter } from "@/apps/cli/adapters/NodeFileSystemAdapter";
import { CLIFileNameSource } from "./CLIFileNameSource";
import { ObservedNodeStorageAdapter } from "./ObservedNodeStorageAdapter";

async function withSource(
    version: 0 | 1,
    run: (fixture: {
        root: string;
        source: CLIFileNameSource;
        storage: ObservedNodeStorageAdapter;
        policy: PathComparisonSettings;
        prepare: () => Promise<void>;
        listExpected: () => Promise<string[]>;
    }) => Promise<void>
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-name-membership-"));
    const policy: PathComparisonSettings = { pathNormalizationVersion: version, handleFilenameCaseSensitive: true };
    const watcher = Object.assign(new EventEmitter(), { close: async () => undefined });
    let source: CLIFileNameSource;
    const storage = new ObservedNodeStorageAdapter(
        root,
        () => version,
        () => false,
        (paths) => source.invalidate(paths)
    );
    source = new CLIFileNameSource(storage, () => policy, {
        basePath: root,
        watcherFactory: () => watcher as unknown as FSWatcher,
    });
    const expected = new NodeFileSystemAdapter(root, undefined, () => version);
    try {
        await run({
            root,
            source,
            storage,
            policy,
            prepare: async () => {
                const pending = source.prepare();
                watcher.emit("ready");
                await pending;
            },
            listExpected: async () => (await expected.getFiles()).map((file) => file.path).sort(),
        });
    } finally {
        await source.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

describe("CLI watched membership and the supported physical listing", () => {
    it("skips excluded Legacy directory siblings when selecting a supported parent", async () => {
        await withSource(0, async ({ root, source, policy, prepare, listExpected }) => {
            fs.mkdirSync(path.join(root, "C:unsupported"));
            fs.mkdirSync(path.join(root, "docs"));
            fs.writeFileSync(path.join(root, "docs/note.md"), "safe");
            await prepare();
            expect(await source.getFileNames()).toEqual(await listExpected());
            await expect(source.findPathIdentityCandidates(parseFilePath("docs/note.md"), policy)).resolves.toEqual([
                "docs/note.md",
            ]);
            expect(fs.readFileSync(path.join(root, "docs/note.md"), "utf8")).toBe("safe");
        });
    });

    it.each([0, 1] as const)(
        "keeps hidden-directory mutations outside membership, with hidden leaf files retained (version %i)",
        async (version) => {
            await withSource(version, async ({ root, source, storage, prepare, listExpected }) => {
                fs.mkdirSync(path.join(root, ".hidden"));
                fs.mkdirSync(path.join(root, "notes/.private"), { recursive: true });
                fs.writeFileSync(path.join(root, "safe.md"), "safe");
                await prepare();
                await storage.write(".hidden/internal.md", "private");
                await storage.write("notes/.private/nested.md", "nested");
                await storage.write(".visible.md", "supported leaf");
                await storage.write("notes/.leaf.md", "supported nested leaf");
                expect((await source.getFileNames()).sort()).toEqual(await listExpected());
                expect((await source.getFileNames()).sort()).toEqual([".visible.md", "notes/.leaf.md", "safe.md"]);
                await storage.rename(".hidden/internal.md", "notes/moved.md");
                expect((await source.getFileNames()).sort()).toEqual(await listExpected());
                await storage.rename("notes/moved.md", ".hidden/returned.md");
                expect((await source.getFileNames()).sort()).toEqual(await listExpected());
                expect((await source.getFileNames({ fresh: true })).sort()).toEqual(await listExpected());
                expect(fs.readFileSync(path.join(root, ".hidden/returned.md"), "utf8")).toBe("private");
            });
        }
    );

    it.each(["write", "writeBinary", "append", "mkdir"] as const)(
        "updates an NFD physical parent after logical NFC %s before watcher delivery",
        async (operation) => {
            await withSource(1, async ({ root, source, storage, prepare, listExpected }) => {
                fs.mkdirSync(path.join(root, "cafe\u0301"));
                fs.mkdirSync(path.join(root, "unrelated"));
                fs.writeFileSync(path.join(root, "cafe\u0301/existing.md"), "old");
                fs.writeFileSync(path.join(root, "unrelated/keep.md"), "unrelated");
                await prepare();
                const reads = vi.spyOn(storage, "readDirectory");
                const target = "caf\u00e9/new/note.md";
                if (operation === "writeBinary") {
                    await storage.writeBinary(target, new Uint8Array([1, 2, 3]).buffer);
                } else if (operation === "mkdir") {
                    await storage.mkdir("caf\u00e9/new");
                    await storage.write(target, "new");
                } else {
                    await storage[operation](target, "new");
                }
                expect((await source.getFileNames()).sort()).toEqual(await listExpected());
                expect(reads.mock.calls.some(([directory]) => directory === "unrelated")).toBe(false);
                expect(fs.existsSync(path.join(root, "cafe\u0301/new/note.md"))).toBe(true);
            });
        }
    );

    it("retires and adds physical memberships for logical NFC rename and removal", async () => {
        await withSource(1, async ({ root, source, storage, prepare, listExpected }) => {
            fs.mkdirSync(path.join(root, "cafe\u0301"));
            fs.mkdirSync(path.join(root, "re\u0301sume\u0301"));
            fs.writeFileSync(path.join(root, "cafe\u0301/old.md"), "preserved");
            await prepare();
            await storage.rename("caf\u00e9/old.md", "r\u00e9sum\u00e9/new.md");
            expect((await source.getFileNames()).sort()).toEqual(await listExpected());
            expect(await source.getFileNames()).toEqual(["re\u0301sume\u0301/new.md"]);
            await storage.remove("r\u00e9sum\u00e9/new.md");
            expect(await source.getFileNames()).toEqual([]);
            expect(await source.getFileNames()).toEqual(await listExpected());
        });
    });

    it("replays a logical invalidation captured before initial physical coverage was published", async () => {
        await withSource(1, async ({ root, source, storage, prepare, listExpected }) => {
            fs.mkdirSync(path.join(root, "cafe\u0301"));
            fs.writeFileSync(path.join(root, "cafe\u0301/existing.md"), "old");
            const originalRead = storage.readDirectory.bind(storage);
            let mutated = false;
            vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                const entries = await originalRead(directory);
                if (directory === "cafe\u0301" && !mutated) {
                    mutated = true;
                    await storage.write("caf\u00e9/added.md", "new");
                }
                return entries;
            });
            await prepare();
            expect((await source.getFileNames()).sort()).toEqual(await listExpected());
        });
    });
    it("retries a physical-parent read superseded by a logical NFC mutation", async () => {
        await withSource(1, async ({ root, source, storage, policy, prepare }) => {
            fs.mkdirSync(path.join(root, "cafe\u0301"));
            fs.writeFileSync(path.join(root, "cafe\u0301/existing.md"), "old");
            await prepare();
            const originalRead = storage.readDirectory.bind(storage);
            let mutated = false;
            vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                const entries = await originalRead(directory);
                if (directory === "cafe\u0301" && !mutated) {
                    mutated = true;
                    await storage.write("caf\u00e9/added.md", "new");
                }
                return entries;
            });
            await expect(
                source.findPathIdentityCandidates(parseFilePath("caf\u00e9/added.md"), policy)
            ).resolves.toEqual(["cafe\u0301/added.md"]);
        });
    });

    it("invalidates the physical parent when NFC I/O overrides the default case rule", async () => {
        await withSource(1, async ({ root, source, storage, prepare, listExpected }) => {
            fs.mkdirSync(path.join(root, "Cafe\u0301"));
            fs.writeFileSync(path.join(root, "Cafe\u0301/existing.md"), "old");
            await prepare();
            await storage.write("CAF\u00c9/added.md", "new", undefined, true);
            expect((await source.getFileNames()).sort()).toEqual(await listExpected());
            expect(await source.getFileNames()).toContain("Cafe\u0301/added.md");
        });
    });

    it("retires whole subtrees after logical NFC directory rename and deletion", async () => {
        await withSource(1, async ({ root, source, storage, prepare, listExpected }) => {
            fs.mkdirSync(path.join(root, "cafe\u0301/sub"), { recursive: true });
            fs.mkdirSync(path.join(root, "re\u0301sume\u0301"));
            fs.writeFileSync(path.join(root, "cafe\u0301/sub/note.md"), "preserved");
            await prepare();
            await storage.rename("caf\u00e9/sub", "r\u00e9sum\u00e9/moved");
            expect((await source.getFileNames()).sort()).toEqual(await listExpected());
            expect(await source.getFileNames()).toEqual(["re\u0301sume\u0301/moved/note.md"]);
            expect(fs.readFileSync(path.join(root, "re\u0301sume\u0301/moved/note.md"), "utf8")).toBe("preserved");
            await storage.remove("r\u00e9sum\u00e9/moved");
            expect(await source.getFileNames()).toEqual([]);
            expect(await source.getFileNames()).toEqual(await listExpected());
        });
    });
});
