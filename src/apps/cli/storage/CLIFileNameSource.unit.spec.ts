import { EventEmitter } from "node:events";
import { fs, os, path, UnicodeResolvingNodeStorageAdapter } from "@vrtmrz/livesync-commonlib/node";
import {
    FilePathIndex,
    parseFilePath,
    type PathComparisonSettings,
    type StoragePath,
} from "@vrtmrz/livesync-commonlib/storage";
import type { ChokidarOptions, FSWatcher } from "chokidar";
import type { IStorageEventWatchHandlers } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIFileNameSource } from "./CLIFileNameSource";
import { ObservedNodeStorageAdapter } from "./ObservedNodeStorageAdapter";

type TestWatcher = {
    readonly eventEmitter: EventEmitter;
    readonly watcher: FSWatcher;
    readonly close: ReturnType<typeof vi.fn>;
};

const roots: string[] = [];

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
}

function makeWatcher(autoReady = true): TestWatcher {
    const eventEmitter = new EventEmitter();
    const close = vi.fn(async () => undefined);
    const watcher = Object.assign(eventEmitter, { close }) as unknown as FSWatcher;
    if (autoReady) {
        queueMicrotask(() => eventEmitter.emit("ready"));
    }
    return { eventEmitter, watcher, close };
}

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-name-source-"));
    roots.push(root);
    return root;
}

function policy(version = 0, caseSensitive = true): PathComparisonSettings {
    return {
        pathNormalizationVersion: version as 0 | 1,
        handleFilenameCaseSensitive: caseSensitive,
    };
}

function makeSource(
    root: string,
    getPolicy: () => PathComparisonSettings,
    watcher: TestWatcher,
    storage: UnicodeResolvingNodeStorageAdapter = new UnicodeResolvingNodeStorageAdapter(
        root,
        () => getPolicy().pathNormalizationVersion,
        () => !getPolicy().handleFilenameCaseSensitive
    )
): CLIFileNameSource {
    const watcherFactory = (_basePath: string, _options: ChokidarOptions): FSWatcher => watcher.watcher;
    return new CLIFileNameSource(storage, getPolicy, { basePath: root, watcherFactory });
}

async function prepare(source: CLIFileNameSource, watcher: TestWatcher): Promise<void> {
    const preparation = source.prepare();
    await Promise.resolve();
    watcher.eventEmitter.emit("ready");
    await preparation;
}

function emit(watcher: TestWatcher, type: string, root: string, relativePath: string): void {
    watcher.eventEmitter.emit(type, path.join(root, relativePath));
}

async function closeAndRemove(source: CLIFileNameSource, root: string): Promise<void> {
    await source.close();
    fs.rmSync(root, { recursive: true, force: true });
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe("CLIFileNameSource", () => {
    it("updates one changed directory without another full inventory or index replacement", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "sub"), { recursive: true });
        fs.writeFileSync(path.join(root, "sub", "note.md"), "initial");
        const watcher = makeWatcher();
        let currentPolicy = policy();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const readDirectory = vi.spyOn(storage, "readDirectory");
        const replaceAll = vi.spyOn(FilePathIndex.prototype, "replaceAll");
        const source = makeSource(root, () => currentPolicy, watcher, storage);

        try {
            await prepare(source, watcher);
            expect(replaceAll).toHaveBeenCalledTimes(1);
            const initialReads = readDirectory.mock.calls.length;

            emit(watcher, "change", root, "sub/note.md");
            expect(await source.getFileNames()).toEqual([parseFilePath("sub/note.md")]);

            expect(readDirectory.mock.calls.length - initialReads).toBe(1);
            expect(replaceAll).toHaveBeenCalledTimes(1);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("finds an NFC alias created before its watcher notification", async () => {
        const root = makeRoot();
        let currentPolicy = policy();
        const watcher = makeWatcher();
        const source = makeSource(root, () => currentPolicy, watcher);
        const nfc = "caf\u00e9.md";
        const nfd = "cafe\u0301.md";

        try {
            await prepare(source, watcher);
            fs.writeFileSync(path.join(root, nfc), "one");
            fs.writeFileSync(path.join(root, nfd), "two");

            await expect(source.findPathIdentityCandidates(parseFilePath(nfc), policy(1, true))).rejects.toThrow(
                "Ambiguous path after Unicode normalisation"
            );
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("retains a failed fresh NFC validation until a fresh scan repairs the unrelated scope", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "unrelated"), { recursive: true });
        fs.writeFileSync(path.join(root, "safe.md"), "safe");
        const currentPolicy = policy(1, true);
        const watcher = makeWatcher();
        const source = makeSource(root, () => currentPolicy, watcher);
        const nfc = "café.md";
        const nfd = "café.md";

        try {
            await prepare(source, watcher);
            fs.writeFileSync(path.join(root, "unrelated", nfc), "one");
            fs.writeFileSync(path.join(root, "unrelated", nfd), "two");

            await expect(source.getFileNames({ fresh: true })).rejects.toThrow(/Ambiguous/);
            await expect(source.findPathIdentityCandidates(parseFilePath("safe.md"), currentPolicy)).rejects.toThrow(
                /Ambiguous/
            );

            fs.rmSync(path.join(root, "unrelated", nfd));
            expect(fs.existsSync(path.join(root, "unrelated", nfd))).toBe(false);
            expect(fs.readdirSync(path.join(root, "unrelated"))).toEqual([nfc]);
            const internalStorage = (source as unknown as { storage: UnicodeResolvingNodeStorageAdapter }).storage;
            await expect(internalStorage.readDirectory(parseFilePath("unrelated") as StoragePath)).resolves.toEqual([
                { name: nfc, kind: "file" },
            ]);
            await expect(source.getFileNames({ fresh: true })).resolves.toEqual(
                expect.arrayContaining([parseFilePath("safe.md"), parseFilePath("unrelated/" + nfc)])
            );
            await expect(source.findPathIdentityCandidates(parseFilePath("safe.md"), currentPolicy)).resolves.toEqual([
                parseFilePath("safe.md"),
            ]);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("collects equivalent parent branches and every matching file in Legacy case-insensitive mode", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "Docs"), { recursive: true });
        fs.mkdirSync(path.join(root, "docs"), { recursive: true });
        fs.writeFileSync(path.join(root, "Docs", "Note.md"), "one");
        fs.writeFileSync(path.join(root, "docs", "note.md"), "two");
        const currentPolicy = policy(0, false);
        const watcher = makeWatcher();
        const source = makeSource(root, () => currentPolicy, watcher);

        try {
            await prepare(source, watcher);
            await expect(
                source.findPathIdentityCandidates(parseFilePath("docs/note.md"), currentPolicy)
            ).resolves.toEqual([parseFilePath("Docs/Note.md"), parseFilePath("docs/note.md")]);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("blocks all NFC lookups on a known unrelated alias and clears it after that directory is repaired", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "unrelated"), { recursive: true });
        fs.writeFileSync(path.join(root, "safe.md"), "safe");
        let currentPolicy = policy();
        const watcher = makeWatcher();
        const source = makeSource(root, () => currentPolicy, watcher);
        const nfc = "caf\u00e9.md";
        const nfd = "cafe\u0301.md";

        try {
            await prepare(source, watcher);
            currentPolicy = policy(1, true);
            fs.writeFileSync(path.join(root, "unrelated", nfc), "one");
            fs.writeFileSync(path.join(root, "unrelated", nfd), "two");
            emit(watcher, "add", root, "unrelated/" + nfc);

            await expect(source.findPathIdentityCandidates(parseFilePath("safe.md"), currentPolicy)).rejects.toThrow(
                /Ambiguous/
            );

            fs.rmSync(path.join(root, "unrelated", nfd));
            emit(watcher, "unlink", root, "unrelated/" + nfd);
            await expect(source.getFileNames()).resolves.toEqual([
                parseFilePath("safe.md"),
                parseFilePath("unrelated/" + nfc),
            ]);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("revalidates parent aliases when the active Unicode or case policy changes", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "Notes"));
        fs.mkdirSync(path.join(root, "notes"));
        fs.writeFileSync(path.join(root, "Notes/a.md"), "upper parent");
        fs.writeFileSync(path.join(root, "notes/b.md"), "lower parent");
        const watcher = makeWatcher();
        let activePolicy = policy(0, false);
        const source = makeSource(root, () => activePolicy, watcher);
        try {
            await prepare(source, watcher);
            await expect(source.findPathIdentityCandidates(parseFilePath("Notes/a.md"), activePolicy)).resolves.toEqual(
                ["Notes/a.md"]
            );
            activePolicy = policy(1, false);
            await expect(source.findPathIdentityCandidates(parseFilePath("Notes/a.md"), activePolicy)).rejects.toThrow(
                /Ambiguous/
            );
            activePolicy = policy(1, true);
            await expect(source.findPathIdentityCandidates(parseFilePath("Notes/a.md"), activePolicy)).resolves.toEqual(
                ["Notes/a.md"]
            );
            activePolicy = policy(0, true);
            await expect(source.findPathIdentityCandidates(parseFilePath("notes/b.md"), activePolicy)).resolves.toEqual(
                ["notes/b.md"]
            );
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("settles preparation and closes the watcher when closed before ready", async () => {
        const root = makeRoot();
        const watcher = makeWatcher(false);
        const source = makeSource(root, () => policy(), watcher);
        const preparation = source.prepare();
        const rejected = expect(preparation).rejects.toThrow("closed before watcher readiness");

        await source.close();
        await rejected;
        await expect(source.prepare()).rejects.toThrow("closed");
        expect(watcher.close).toHaveBeenCalledTimes(1);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("preserves a synchronous watcher-close failure during failed preparation", async () => {
        const root = makeRoot();
        const watcher = makeWatcher(false);
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const readFailure = new Error("initial directory read failed");
        const closeFailure = new Error("synchronous watcher close failed");
        vi.spyOn(storage, "readDirectory").mockRejectedValue(readFailure);
        watcher.close.mockImplementation(() => {
            throw closeFailure;
        });
        const source = makeSource(root, () => policy(), watcher, storage);
        try {
            const preparation = source.prepare();
            const rejected = expect(preparation).rejects.toBe(closeFailure);
            await Promise.resolve();
            watcher.eventEmitter.emit("ready");
            await rejected;
            expect(watcher.close).toHaveBeenCalledTimes(1);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("buffers only observed startup events and hands them off in arrival order", async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, "seed.md"), "seed");
        const watcher = makeWatcher();
        const currentPolicy = policy();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const originalReadDirectory = storage.readDirectory.bind(storage);
        const readDirectory = vi.spyOn(storage, "readDirectory");
        let emitted = false;
        readDirectory.mockImplementation(async (directory) => {
            const entries = await originalReadDirectory(directory);
            if (directory === "" && !emitted) {
                emitted = true;
                fs.writeFileSync(path.join(root, "during-startup.md"), "new");
                emit(watcher, "add", root, "during-startup.md");
                emit(watcher, "change", root, "during-startup.md");
                fs.writeFileSync(path.join(root, ".hidden-during-startup.md"), "hidden");
                emit(watcher, "add", root, ".hidden-during-startup.md");
            }
            return entries;
        });
        const source = makeSource(root, () => currentPolicy, watcher, storage);
        const delivered: string[] = [];
        const handlers = {
            onCreate: vi.fn((file: { path: string }) => delivered.push("create:" + file.path)),
            onChange: vi.fn((file: { path: string }) => delivered.push("change:" + file.path)),
            onDelete: vi.fn(),
            onRename: vi.fn(),
        } as unknown as IStorageEventWatchHandlers;

        try {
            await prepare(source, watcher);
            await expect(source.getFileNames()).resolves.toEqual(
                expect.arrayContaining([parseFilePath("during-startup.md"), parseFilePath("seed.md")])
            );
            expect(delivered).toEqual([]);
            const buffered = Reflect.get(Reflect.get(source, "watch"), "bufferedEvents") as unknown[];
            expect(buffered).toHaveLength(2);
            expect(await source.getFileNames()).toContain(".hidden-during-startup.md");

            await source.beginWatch(handlers);
            expect(delivered).toEqual(["create:during-startup.md", "change:during-startup.md"]);
            expect(handlers.onCreate).toHaveBeenCalledTimes(1);
            expect(handlers.onChange).toHaveBeenCalledTimes(1);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("keeps one finite name-list boundary when a watched directory changes during reconciliation", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "sub"), { recursive: true });
        fs.writeFileSync(path.join(root, "sub", "note.md"), "initial");
        const watcher = makeWatcher();
        const currentPolicy = policy();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const source = makeSource(root, () => currentPolicy, watcher, storage);
        const internal = source as unknown as {
            markPathsDirty(paths: readonly string[]): void;
            invalidatedDirectories: Map<string, number>;
        };

        try {
            await prepare(source, watcher);
            internal.markPathsDirty(["sub/note.md"]);
            const originalReadDirectory = storage.readDirectory.bind(storage);
            const readDirectory = vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                internal.markPathsDirty(["sub/note.md"]);
                return await originalReadDirectory(directory);
            });

            await expect(source.getFileNames()).rejects.toThrow("captured boundary");
            expect(readDirectory).toHaveBeenCalledTimes(1);
            expect(internal.invalidatedDirectories.has("sub")).toBe(true);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("prunes directory generations after repeated folder creation and deletion", async () => {
        const root = makeRoot();
        const watcher = makeWatcher();
        const source = makeSource(root, () => policy(), watcher);
        const generations = (source as unknown as { directoryGenerations: Map<string, number> }).directoryGenerations;
        const invalidations = (source as unknown as { invalidatedDirectories: Map<string, number> })
            .invalidatedDirectories;

        try {
            await prepare(source, watcher);
            for (let index = 0; index < 8; index++) {
                const folder = "temporary-" + index;
                fs.mkdirSync(path.join(root, folder));
                fs.writeFileSync(path.join(root, folder, "note.md"), "content");
                emit(watcher, "addDir", root, folder);
                emit(watcher, "add", root, folder + "/note.md");
                await source.getFileNames();

                fs.rmSync(path.join(root, folder), { recursive: true, force: true });
                emit(watcher, "unlinkDir", root, folder);
                await source.getFileNames();
                expect(Array.from(generations.keys()).every((directory) => directory === "")).toBe(true);
                expect(invalidations.size).toBe(0);
            }
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("reconciles a partial write failure after always completing mutation invalidation", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "notes"), { recursive: true });
        const currentPolicy = policy();
        const watcher = makeWatcher();
        let source: CLIFileNameSource;
        const storage = new ObservedNodeStorageAdapter(
            root,
            () => currentPolicy.pathNormalizationVersion,
            () => !currentPolicy.handleFilenameCaseSensitive,
            (paths) => source.invalidate(paths)
        );
        source = makeSource(root, () => currentPolicy, watcher, storage);
        const write = vi
            .spyOn(UnicodeResolvingNodeStorageAdapter.prototype, "write")
            .mockImplementation(async (relativePath: string) => {
                fs.writeFileSync(path.join(root, relativePath), "partially written");
                throw new Error("injected write failure after physical change");
            });

        try {
            await prepare(source, watcher);
            await expect(storage.write("notes/partial.md", "body")).rejects.toThrow(
                "injected write failure after physical change"
            );
            await expect(source.getFileNames()).resolves.toEqual([parseFilePath("notes/partial.md")]);
        } finally {
            write.mockRestore();
            await closeAndRemove(source, root);
        }
    });
    it("retains direct mutation observations when a fresh scan is rejected", async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, "before.md"), "before");
        const watcher = makeWatcher();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const source = makeSource(root, () => policy(), watcher, storage);
        const started = deferred<void>();
        const release = deferred<void>();
        try {
            await prepare(source, watcher);
            const read = storage.readDirectory.bind(storage);
            vi.spyOn(storage, "readDirectory").mockImplementationOnce(async (directory) => {
                const entries = await read(directory);
                started.resolve(undefined);
                await release.promise;
                return entries;
            });

            const fresh = source.getFileNames({ fresh: true });
            const rejected = expect(fresh).rejects.toThrow("local storage mutation overlapped");
            await started.promise;
            const complete = source.invalidate(["added.md"]);
            try {
                fs.writeFileSync(path.join(root, "added.md"), "retained local write");
            } finally {
                complete();
            }
            release.resolve(undefined);
            await rejected;

            await expect(source.getFileNames()).resolves.toEqual(expect.arrayContaining(["before.md", "added.md"]));
            expect(fs.readFileSync(path.join(root, "added.md"), "utf8")).toBe("retained local write");
        } finally {
            release.resolve(undefined);
            await closeAndRemove(source, root);
        }
    });

    it("retains watched scopes when unrelated local I/O rejects a fresh candidate", async () => {
        const root = makeRoot();
        for (const directory of ["a", "b"]) {
            fs.mkdirSync(path.join(root, directory));
            fs.writeFileSync(path.join(root, directory, "before.md"), "before");
        }
        const watcher = makeWatcher();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const source = makeSource(root, () => policy(), watcher, storage);
        const started = deferred<void>();
        const release = deferred<void>();
        try {
            await prepare(source, watcher);
            const read = storage.readDirectory.bind(storage);
            let observed = false;
            let readsOfA = 0;
            vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                const entries = await read(directory);
                if (directory === "" && !observed) {
                    observed = true;
                    fs.writeFileSync(path.join(root, "a/observed.md"), "observed");
                    emit(watcher, "add", root, "a/observed.md");
                }
                if (directory === "a" && ++readsOfA === 2) {
                    started.resolve(undefined);
                    await release.promise;
                }
                return entries;
            });

            const fresh = source.getFileNames({ fresh: true });
            const rejected = expect(fresh).rejects.toThrow("local storage mutation overlapped");
            await started.promise;
            const complete = source.invalidate(["b/local.md"]);
            try {
                fs.writeFileSync(path.join(root, "b/local.md"), "local");
            } finally {
                complete();
            }
            release.resolve(undefined);
            await rejected;

            await expect(source.getFileNames()).resolves.toEqual(
                expect.arrayContaining(["a/observed.md", "b/local.md"])
            );
        } finally {
            release.resolve(undefined);
            await closeAndRemove(source, root);
        }
    });

    it("retains successful scope observations when a fresh reconciliation is superseded", async () => {
        const root = makeRoot();
        for (const directory of ["a", "b"]) {
            fs.mkdirSync(path.join(root, directory));
            fs.writeFileSync(path.join(root, directory, "before.md"), "before");
        }
        const watcher = makeWatcher();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const source = makeSource(root, () => policy(), watcher, storage);
        const started = deferred<void>();
        const release = deferred<void>();
        try {
            await prepare(source, watcher);
            const read = storage.readDirectory.bind(storage);
            let observed = false;
            let readsOfA = 0;
            vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                const entries = await read(directory);
                if (directory === "" && !observed) {
                    observed = true;
                    for (const child of ["a/observed.md", "b/observed.md"]) {
                        fs.writeFileSync(path.join(root, child), "observed");
                        emit(watcher, "add", root, child);
                    }
                }
                if (directory === "a" && ++readsOfA === 2) {
                    started.resolve(undefined);
                    await release.promise;
                }
                return entries;
            });

            const fresh = source.getFileNames({ fresh: true });
            const rejected = expect(fresh).rejects.toThrow("observations changed during fresh enumeration");
            await started.promise;
            emit(watcher, "change", root, "a/observed.md");
            release.resolve(undefined);
            await rejected;

            await expect(source.getFileNames()).resolves.toEqual(
                expect.arrayContaining(["a/observed.md", "b/observed.md"])
            );
        } finally {
            release.resolve(undefined);
            await closeAndRemove(source, root);
        }
    });
    it("rejects name reads before preparation and after close", async () => {
        const root = makeRoot();
        const watcher = makeWatcher(false);
        const source = makeSource(root, () => policy(), watcher);
        try {
            await expect(source.getFileNames()).rejects.toThrow("has not been prepared");
            await source.close();
            await expect(source.getFileNames()).rejects.toThrow("closed");
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("shares preparation and lets a waiting reader use the completed inventory", async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, "ready.md"), "ready");
        const watcher = makeWatcher(false);
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const read = vi.spyOn(storage, "readDirectory");
        const source = makeSource(root, () => policy(), watcher, storage);
        try {
            const first = source.prepare();
            expect(source.prepare()).toBe(first);
            const names = source.getFileNames();
            watcher.eventEmitter.emit("ready");
            await first;
            await source.prepare();
            await expect(names).resolves.toEqual(["ready.md"]);
            expect(read).toHaveBeenCalledOnce();
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("keeps failed preparation unavailable for later reads and prepare calls", async () => {
        const root = makeRoot();
        const watcher = makeWatcher(false);
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const failure = new Error("root listing failed");
        vi.spyOn(storage, "readDirectory").mockRejectedValue(failure);
        const source = makeSource(root, () => policy(), watcher, storage);
        try {
            const preparation = source.prepare();
            const rejected = expect(preparation).rejects.toBe(failure);
            watcher.eventEmitter.emit("ready");
            await rejected;
            await expect(source.prepare()).rejects.toBe(failure);
            await expect(source.getFileNames()).rejects.toBe(failure);
            expect(watcher.close).toHaveBeenCalledOnce();
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("waits for host I/O completion and tolerates a duplicate completion", async () => {
        const root = makeRoot();
        const watcher = makeWatcher();
        const source = makeSource(root, () => policy(), watcher);
        let complete: () => void = () => undefined;
        try {
            await prepare(source, watcher);
            complete = source.invalidate(["pending.md"]);
            fs.writeFileSync(path.join(root, "pending.md"), "pending");
            let settled = false;
            const names = source.getFileNames().then((result) => {
                settled = true;
                return result;
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(settled).toBe(false);
            complete();
            complete();
            await expect(names).resolves.toEqual(["pending.md"]);
        } finally {
            complete();
            await closeAndRemove(source, root);
        }
    });

    it("rejects fresh and queued reads when close retires their inventory", async () => {
        const root = makeRoot();
        const watcher = makeWatcher();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const source = makeSource(root, () => policy(), watcher, storage);
        const started = deferred<void>();
        const release = deferred<void>();
        try {
            await prepare(source, watcher);
            const read = storage.readDirectory.bind(storage);
            vi.spyOn(storage, "readDirectory").mockImplementationOnce(async (directory) => {
                const entries = await read(directory);
                started.resolve(undefined);
                await release.promise;
                return entries;
            });
            const fresh = source.getFileNames({ fresh: true });
            const rejectedFresh = expect(fresh).rejects.toThrow("closed");
            await started.promise;
            const queued = source.getFileNames();
            const rejectedQueued = expect(queued).rejects.toThrow("inventory is unavailable");
            await new Promise<void>((resolve) => setImmediate(resolve));
            const closing = source.close();
            release.resolve(undefined);
            await rejectedFresh;
            await rejectedQueued;
            await closing;
            await expect(source.getFileNames()).rejects.toThrow("closed");
        } finally {
            release.resolve(undefined);
            await closeAndRemove(source, root);
        }
    });

    it("restores observations through a reader's earlier captured boundary", async () => {
        const root = makeRoot();
        for (const directory of ["a", "b"]) {
            fs.mkdirSync(path.join(root, directory));
            fs.writeFileSync(path.join(root, directory, "before.md"), "before");
        }
        const watcher = makeWatcher();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const source = makeSource(root, () => policy(), watcher, storage);
        const started = deferred<void>();
        const release = deferred<void>();
        try {
            await prepare(source, watcher);
            const read = storage.readDirectory.bind(storage);
            let observed = false;
            let readsOfB = 0;
            vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                const entries = await read(directory);
                if (directory === "" && !observed) {
                    observed = true;
                    for (const child of ["a/observed.md", "b/observed.md"]) {
                        fs.writeFileSync(path.join(root, child), "observed");
                        emit(watcher, "add", root, child);
                    }
                }
                if (directory === "b" && ++readsOfB === 2) {
                    started.resolve(undefined);
                    await release.promise;
                }
                return entries;
            });
            const fresh = source.getFileNames({ fresh: true });
            const rejected = expect(fresh).rejects.toThrow("observations changed during fresh enumeration");
            await started.promise;
            const capturedRead = source.getFileNames();
            // Let this request capture its boundary before the later native-event turn.
            await new Promise<void>((resolve) => setImmediate(resolve));
            emit(watcher, "change", root, "a/observed.md");
            emit(watcher, "change", root, "b/observed.md");
            release.resolve(undefined);
            await rejected;
            await expect(capturedRead).resolves.toEqual(expect.arrayContaining(["a/observed.md", "b/observed.md"]));
        } finally {
            release.resolve(undefined);
            await closeAndRemove(source, root);
        }
    });

    it("rejects an unavailable root and recovers after that scope is recreated", async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, "before.md"), "before");
        const watcher = makeWatcher();
        const source = makeSource(root, () => policy(0), watcher);
        try {
            await prepare(source, watcher);
            const complete = source.invalidate([""]);
            fs.rmSync(root, { recursive: true, force: true });
            complete();
            await expect(source.getFileNames()).rejects.toThrow("root is unavailable");

            fs.mkdirSync(root);
            fs.writeFileSync(path.join(root, "after.md"), "after");
            emit(watcher, "add", root, "after.md");
            await expect(source.getFileNames()).resolves.toEqual(["after.md"]);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("clears a known fresh failure only after the affected scope validates", async () => {
        const root = makeRoot();
        fs.mkdirSync(path.join(root, "blocked"));
        fs.writeFileSync(path.join(root, "visible.md"), "visible");
        const watcher = makeWatcher();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const selectedPolicy = policy(1);
        const source = makeSource(root, () => selectedPolicy, watcher, storage);
        try {
            await prepare(source, watcher);
            const read = storage.readDirectory.bind(storage);
            const failure = new Error("blocked scope cannot be read");
            const listing = vi.spyOn(storage, "readDirectory").mockImplementation((directory) => {
                if (directory === "blocked") {
                    return Promise.reject(failure);
                }
                return read(directory);
            });
            await expect(source.getFileNames({ fresh: true })).rejects.toBe(failure);
            await expect(source.findPathIdentityCandidates(parseFilePath("visible.md"), selectedPolicy)).rejects.toBe(
                failure
            );

            listing.mockRestore();
            fs.writeFileSync(path.join(root, "blocked/restored.md"), "restored");
            emit(watcher, "add", root, "blocked/restored.md");
            await expect(source.getFileNames()).resolves.toEqual(
                expect.arrayContaining(["visible.md", "blocked/restored.md"])
            );
            await expect(
                source.findPathIdentityCandidates(parseFilePath("visible.md"), selectedPolicy)
            ).resolves.toEqual(["visible.md"]);
        } finally {
            await closeAndRemove(source, root);
        }
    });

    it("retries a target read superseded by a watched alias before choosing candidates", async () => {
        const root = makeRoot();
        fs.writeFileSync(path.join(root, "note.md"), "original");
        const watcher = makeWatcher();
        const storage = new UnicodeResolvingNodeStorageAdapter(root);
        const selectedPolicy = policy(0, false);
        const source = makeSource(root, () => selectedPolicy, watcher, storage);
        const started = deferred<void>();
        const release = deferred<void>();
        try {
            await prepare(source, watcher);
            const read = storage.readDirectory.bind(storage);
            let firstRootRead = true;
            const listing = vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                const entries = await read(directory);
                if (directory === "" && firstRootRead) {
                    firstRootRead = false;
                    started.resolve(undefined);
                    await release.promise;
                }
                return entries;
            });
            const candidates = source.findPathIdentityCandidates(parseFilePath("note.md"), selectedPolicy);
            await started.promise;
            fs.writeFileSync(path.join(root, "NOTE.MD"), "external alias");
            emit(watcher, "add", root, "NOTE.MD");
            release.resolve(undefined);

            await expect(candidates).resolves.toEqual(["NOTE.MD", "note.md"]);
            expect(listing.mock.calls.filter(([directory]) => directory === "").length).toBeGreaterThan(1);
            expect(fs.readFileSync(path.join(root, "note.md"), "utf8")).toBe("original");
            expect(fs.readFileSync(path.join(root, "NOTE.MD"), "utf8")).toBe("external alias");
        } finally {
            release.resolve(undefined);
            await closeAndRemove(source, root);
        }
    });

    it.each(["local mutation", "watched change"] as const)(
        "rejects an overlapping %s during final-policy reconciliation",
        async (change) => {
            const root = makeRoot();
            for (const directory of ["a", "b"]) {
                fs.mkdirSync(path.join(root, directory));
                fs.writeFileSync(path.join(root, directory, "before.md"), "before");
            }
            const watcher = makeWatcher();
            const storage = new UnicodeResolvingNodeStorageAdapter(root);
            let currentPolicy = policy(0);
            const source = makeSource(root, () => currentPolicy, watcher, storage);
            const legacyReadStarted = deferred<void>();
            const releaseLegacyRead = deferred<void>();
            const finalReadStarted = deferred<void>();
            const releaseFinalRead = deferred<void>();
            let complete: (() => void) | undefined;
            try {
                await prepare(source, watcher);
                const read = storage.readDirectory.bind(storage);
                let readsOfA = 0;
                vi.spyOn(storage, "readDirectory").mockImplementation(async (directory) => {
                    if (directory === "a" && ++readsOfA === 1) {
                        legacyReadStarted.resolve(undefined);
                        await releaseLegacyRead.promise;
                        throw new Error("transient Legacy read failure");
                    }
                    const entries = await read(directory);
                    if (directory === "a" && readsOfA === 2) {
                        finalReadStarted.resolve(undefined);
                        await releaseFinalRead.promise;
                    }
                    return entries;
                });
                const fresh = source.getFileNames({ fresh: true });
                const expectedError =
                    change === "local mutation"
                        ? "local storage mutation overlapped"
                        : "observations changed during fresh enumeration";
                const rejected = expect(fresh).rejects.toThrow(expectedError);
                await legacyReadStarted.promise;
                currentPolicy = policy(1);
                releaseLegacyRead.resolve(undefined);
                await finalReadStarted.promise;
                if (change === "local mutation") {
                    complete = source.invalidate(["b/pending.md"]);
                    fs.writeFileSync(path.join(root, "b/pending.md"), "pending");
                } else {
                    fs.writeFileSync(path.join(root, "a/observed.md"), "observed");
                    emit(watcher, "add", root, "a/observed.md");
                }
                releaseFinalRead.resolve(undefined);
                await rejected;
            } finally {
                complete?.();
                releaseLegacyRead.resolve(undefined);
                releaseFinalRead.resolve(undefined);
                await closeAndRemove(source, root);
            }
        }
    );
});
