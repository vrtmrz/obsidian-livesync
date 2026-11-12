import { EventEmitter } from "node:events";
import { os, path, type Stats } from "@vrtmrz/livesync-commonlib/node";
import type { ChokidarOptions, FSWatcher } from "chokidar";
import type { IStorageEventWatchHandlers } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NodeFile, NodeFolder } from "@/apps/cli/adapters/NodeTypes";
import { CLIFileNameSourceWatch } from "./CLIFileNameSource.watch";

type WatchDependencies = ConstructorParameters<typeof CLIFileNameSourceWatch>[0];
type WatchOverrides = Partial<Omit<WatchDependencies, "basePath" | "options">> & {
    options?: Partial<WatchDependencies["options"]>;
};
type WatchItem = NodeFile | NodeFolder;

type TestWatcher = {
    readonly eventEmitter: EventEmitter;
    readonly watcher: FSWatcher;
    readonly close: ReturnType<typeof vi.fn>;
};

type TestWatch = {
    readonly source: CLIFileNameSourceWatch;
    readonly watcher: TestWatcher;
    readonly dependencies: WatchDependencies;
    readonly watcherFactory: ReturnType<typeof vi.fn>;
};

function makeWatcher(): TestWatcher {
    const eventEmitter = new EventEmitter();
    const close = vi.fn(async () => undefined);
    const watcher = Object.assign(eventEmitter, { close }) as unknown as FSWatcher;
    return { eventEmitter, watcher, close };
}

function makeWatch(basePath: string, overrides: WatchOverrides = {}): TestWatch {
    const watcher = makeWatcher();
    const watcherFactory = vi.fn((_basePath: string, _options: ChokidarOptions) => watcher.watcher);
    const { options: optionOverrides, ...dependencyOverrides } = overrides;
    const dependencies: WatchDependencies = {
        basePath,
        options: { basePath, watcherFactory, ...optionOverrides },
        reportDiagnostic: vi.fn(),
        canObserve: vi.fn(() => true),
        canDeliver: vi.fn(() => true),
        onObservation: vi.fn(),
        onInvalidPath: vi.fn(),
        onFatalError: vi.fn(),
        ...dependencyOverrides,
    };
    return { source: new CLIFileNameSourceWatch(dependencies), watcher, dependencies, watcherFactory };
}

async function startObservation(testWatch: TestWatch): Promise<void> {
    const started = testWatch.source.startObservation();
    testWatch.watcher.eventEmitter.emit("ready");
    await started;
}

function emit(testWatch: TestWatch, type: string, candidatePath: string, stats?: Stats): void {
    testWatch.watcher.eventEmitter.emit(type, candidatePath, stats);
}

function makeHandlers(events: string[] = []) {
    const recordDelivery = (action: string, item: WatchItem): void => {
        const kind = "isFolder" in item ? "folder" : "file";
        events.push(`${action}:${item.path}:${kind}`);
    };
    const onCreate = vi.fn((item: WatchItem) => recordDelivery("create", item));
    const onChange = vi.fn((item: WatchItem) => recordDelivery("change", item));
    const onDelete = vi.fn((item: WatchItem) => recordDelivery("delete", item));
    const handlers = {
        onCreate,
        onChange,
        onDelete,
        onRename: vi.fn(),
        onRaw: vi.fn(),
    } as unknown as IStorageEventWatchHandlers;
    return { handlers, onCreate, onChange, onDelete };
}

const basePath = path.join(os.tmpdir(), "livesync-cli-file-watch-unit-root");

afterEach(() => {
    vi.restoreAllMocks();
});

describe("CLIFileNameSourceWatch", () => {
    it("rejects observation started after close without acquiring a watcher", async () => {
        const testWatch = makeWatch(basePath);
        await testWatch.source.close();

        await expect(testWatch.source.startObservation()).rejects.toThrow("source is closed");
        expect(testWatch.watcherFactory).not.toHaveBeenCalled();
    });

    it("cancels a delayed ready wait and ignores readiness delivered afterwards", async () => {
        const testWatch = makeWatch(basePath);
        const started = testWatch.source.startObservation();
        const rejected = expect(started).rejects.toThrow("closed before watcher readiness");

        await testWatch.source.close();
        testWatch.watcher.eventEmitter.emit("ready");
        await rejected;
        await testWatch.source.close();

        expect(testWatch.watcher.close).toHaveBeenCalledOnce();
    });

    it("rejects repeated delivery activation while preserving the first handlers", async () => {
        const testWatch = makeWatch(basePath);
        await startObservation(testWatch);
        const first = makeHandlers();
        const second = makeHandlers();
        testWatch.source.beginDelivery(first.handlers);

        expect(() => testWatch.source.beginDelivery(second.handlers)).toThrow("already started");
        emit(testWatch, "add", path.join(basePath, "note.md"));

        expect(first.onCreate).toHaveBeenCalledOnce();
        expect(second.onCreate).not.toHaveBeenCalled();
        await testWatch.source.close();
    });

    it("keeps observing after delivery stops and rejects later activation", async () => {
        const testWatch = makeWatch(basePath);
        await startObservation(testWatch);
        const handlers = makeHandlers();
        testWatch.source.beginDelivery(handlers.handlers);
        testWatch.source.stopDelivery();

        emit(testWatch, "add", path.join(basePath, "after-stop.md"));

        expect(testWatch.dependencies.onObservation).toHaveBeenCalledOnce();
        expect(handlers.onCreate).not.toHaveBeenCalled();
        expect(() => testWatch.source.beginDelivery(makeHandlers().handlers)).toThrow("delivery has been stopped");
        await testWatch.source.close();
    });

    it("invalidates before sync-only exclusions and delivers accepted events in arrival order", async () => {
        const testWatch = makeWatch(basePath);
        await startObservation(testWatch);
        const events: string[] = [];
        const handlers = makeHandlers(events);
        const addPath = path.join(basePath, "note.md");
        const folderPath = path.join(basePath, "folder");

        emit(testWatch, "add", addPath);
        emit(testWatch, "change", addPath);
        emit(testWatch, "unlink", addPath);
        emit(testWatch, "addDir", folderPath);
        emit(testWatch, "unlinkDir", folderPath);
        emit(testWatch, "add", path.join(basePath, ".hidden.md"));
        emit(testWatch, "add", path.join(basePath, "internal-livesync-v2", "record.md"));

        expect(
            vi.mocked(testWatch.dependencies.onObservation).mock.calls.map(([type, filePath]) => `${type}:${filePath}`)
        ).toEqual([
            "add:note.md",
            "change:note.md",
            "unlink:note.md",
            "addDir:folder",
            "unlinkDir:folder",
            "add:.hidden.md",
            "add:internal-livesync-v2/record.md",
        ]);

        const beforeDelivery = Date.now();
        testWatch.source.beginDelivery(handlers.handlers);
        const afterDelivery = Date.now();

        expect(events).toEqual([
            "create:note.md:file",
            "change:note.md:file",
            "delete:note.md:file",
            "create:folder:folder",
            "delete:folder:folder",
        ]);
        const created = handlers.onCreate.mock.calls[0]?.[0];
        expect(created).toBeDefined();
        if (!created || !("stat" in created)) {
            throw new Error("Expected a file notification with fallback metadata");
        }
        expect(created.stat.size).toBe(0);
        expect(created.stat.type).toBe("file");
        expect(created.stat.mtime).toBeGreaterThanOrEqual(beforeDelivery);
        expect(created.stat.mtime).toBeLessThanOrEqual(afterDelivery);
        expect(created.stat.ctime).toBe(created.stat.mtime);

        const deletedFolder = handlers.onDelete.mock.calls[1]?.[0];
        expect(deletedFolder).toEqual({ path: "folder", isFolder: true });
        await testWatch.source.close();
    });

    it("drops buffered delivery while the caller disallows delivery", async () => {
        const testWatch = makeWatch(basePath, { canDeliver: () => false });
        await startObservation(testWatch);
        emit(testWatch, "add", path.join(basePath, "buffered.md"));
        const handlers = makeHandlers();

        testWatch.source.beginDelivery(handlers.handlers);

        expect(testWatch.dependencies.onObservation).toHaveBeenCalledOnce();
        expect(handlers.onCreate).not.toHaveBeenCalled();
        await testWatch.source.close();
    });

    it("ignores root and outside paths, observes hidden and sync-only paths, and reports invalid names", async () => {
        const testWatch = makeWatch(basePath);
        await startObservation(testWatch);
        const handlers = makeHandlers();
        testWatch.source.beginDelivery(handlers.handlers);

        emit(testWatch, "add", basePath);
        emit(testWatch, "add", path.resolve(basePath, "..", "outside.md"));
        emit(testWatch, "add", path.join(basePath, ".hidden.md"));
        emit(testWatch, "add", path.join(basePath, "nested-livesync-v2", "entry.md"));
        emit(testWatch, "add", path.join(basePath, "C:\\invalid.md"));

        expect(
            vi.mocked(testWatch.dependencies.onObservation).mock.calls.map(([type, filePath]) => `${type}:${filePath}`)
        ).toEqual(["add:.hidden.md", "add:nested-livesync-v2/entry.md"]);
        expect(testWatch.dependencies.onInvalidPath).toHaveBeenCalledOnce();
        expect(testWatch.dependencies.reportDiagnostic).toHaveBeenCalledOnce();
        expect(handlers.onCreate).not.toHaveBeenCalled();
        await testWatch.source.close();
    });

    it("skips path validation and invalidation while observation is disabled", async () => {
        const testWatch = makeWatch(basePath, { canObserve: () => false });
        await startObservation(testWatch);

        emit(testWatch, "add", path.join(basePath, "C:\\invalid.md"));

        expect(testWatch.dependencies.onObservation).not.toHaveBeenCalled();
        expect(testWatch.dependencies.onInvalidPath).not.toHaveBeenCalled();
        expect(testWatch.dependencies.reportDiagnostic).not.toHaveBeenCalled();
        await testWatch.source.close();
    });

    it("filters hidden directories while retaining hidden leaf files in the watcher scope", async () => {
        const testWatch = makeWatch(basePath);
        await startObservation(testWatch);
        const options = testWatch.watcherFactory.mock.calls[0]?.[1];
        const ignored = options?.ignored;
        if (typeof ignored !== "function") {
            throw new Error("Expected the watcher factory to receive a directory filter");
        }
        const directoryStats = { isDirectory: () => true } as Stats;
        const fileStats = { isDirectory: () => false } as Stats;

        expect(ignored(basePath)).toBe(false);
        expect(ignored(path.join(basePath, ".private"), directoryStats)).toBe(true);
        expect(ignored(path.join(basePath, ".private", "visible.md"), fileStats)).toBe(true);
        expect(ignored(path.join(basePath, ".hidden.md"), fileStats)).toBe(false);
        await testWatch.source.close();
    });

    it("reports suppression-hook failures while retaining name observation", async () => {
        const failure = new Error("suppression failed");
        const testWatch = makeWatch(basePath, {
            options: {
                suppressEvent: () => {
                    throw failure;
                },
            },
        });
        await startObservation(testWatch);
        const handlers = makeHandlers();
        testWatch.source.beginDelivery(handlers.handlers);

        emit(testWatch, "add", path.join(basePath, "note.md"));

        expect(testWatch.dependencies.onObservation).toHaveBeenCalledOnce();
        expect(testWatch.dependencies.reportDiagnostic).toHaveBeenCalledWith(
            expect.stringContaining("Could not evaluate event suppression"),
            failure
        );
        expect(handlers.onCreate).not.toHaveBeenCalled();
        await testWatch.source.close();
    });

    it("marks names unavailable, closes, and requests restart on a fatal watcher error", async () => {
        const failure = new Error("watcher failed");
        const exitSignal = new Error("intercepted process exit");
        const testWatch = makeWatch(basePath);
        const started = testWatch.source.startObservation();
        const rejected = expect(started).rejects.toBe(failure);
        const exit = vi.spyOn(process, "exit").mockImplementation(() => {
            throw exitSignal;
        });

        try {
            expect(() => testWatch.watcher.eventEmitter.emit("error", failure)).toThrow(exitSignal);
            await rejected;

            expect(testWatch.dependencies.onFatalError).toHaveBeenCalledWith(failure);
            expect(testWatch.dependencies.reportDiagnostic).toHaveBeenNthCalledWith(
                1,
                expect.stringContaining("Fatal watcher error"),
                failure
            );
            expect(testWatch.dependencies.reportDiagnostic).toHaveBeenNthCalledWith(
                2,
                expect.stringContaining("Exiting for systemd restart")
            );
            expect(testWatch.watcher.close).toHaveBeenCalledOnce();
            expect(exit).toHaveBeenCalledWith(1);
        } finally {
            exit.mockRestore();
            await testWatch.source.close();
        }
    });
});
