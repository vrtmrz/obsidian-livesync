import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IStorageEventWatchHandlers } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type { CLIFileNameSource } from "@/apps/cli/storage/CLIFileNameSource";
import type { NodeFile } from "@/apps/cli/adapters/NodeTypes";
import { fs, os, path } from "@vrtmrz/livesync-commonlib/node";
import { runtimeScopeDirectory } from "../runtimeState";

// ── chokidar mock ──────────────────────────────────────────────────────────────
// Must be hoisted before imports that pull in chokidar.

const mockWatcher = {
    on: vi.fn().mockReturnThis(),
    once: vi.fn((event: string, cb: () => void) => {
        if (event === "ready") cb();
        return mockWatcher;
    }),
    close: vi.fn(() => Promise.resolve()),
};

vi.mock("chokidar", () => ({
    watch: vi.fn(() => mockWatcher),
}));

import * as chokidar from "chokidar";
import { CLIStorageEventManagerAdapter } from "./CLIStorageEventManagerAdapter";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeHandlers(): IStorageEventWatchHandlers {
    return {
        onCreate: vi.fn(),
        onChange: vi.fn(),
        onDelete: vi.fn(),
        onRename: vi.fn(),
    } as any;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("CLIStorageEventManagerAdapter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore the default once() behaviour (ready fires synchronously).
        mockWatcher.once.mockImplementation((event: string, cb: () => void) => {
            if (event === "ready") cb();
            return mockWatcher;
        });
    });

    it("keeps pending snapshots with the selected database and Vault pair", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "livesync-snapshot-"));
        let database = "first";
        let vault = "vault-a";
        const adapter = new CLIStorageEventManagerAdapter(directory, undefined, false, undefined, () =>
            path.join(runtimeScopeDirectory(directory, database, vault), "storage-events.json")
        );
        try {
            await adapter.persistence.saveSnapshot([{ type: "SENTINEL_FLUSH" }]);
            database = "second";
            expect(await adapter.persistence.loadSnapshot()).toBeNull();
            database = "first";
            vault = "vault-b";
            expect(await adapter.persistence.loadSnapshot()).toBeNull();
            vault = "vault-a";
            expect(await adapter.persistence.loadSnapshot()).toEqual([{ type: "SENTINEL_FLUSH" }]);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("filters only checked Vault-relative candidates and keeps its root watchable", async () => {
        const base = path.resolve(path.sep, ".parent", "vault-livesync-v2");
        const reporter = vi.fn();
        const adapter = new CLIStorageEventManagerAdapter(base, undefined, true, reporter);
        await adapter.watch.beginWatch(makeHandlers());
        const options = vi.mocked(chokidar.watch).mock.calls[0][1];
        const ignored = options?.ignored;
        if (typeof ignored !== "function") {
            throw new Error("Expected the typed watcher filter");
        }
        expect(ignored(base)).toBe(false);
        expect(ignored(path.join(base, "note.md"))).toBe(false);
        expect(ignored(path.join(base, ".hidden.md"))).toBe(true);
        expect(ignored(path.join(base, "local-livesync-v2", "state"))).toBe(true);
        expect(ignored(path.dirname(base))).toBe(true);
        expect(ignored(path.join(base + "-sibling", "note.md"))).toBe(true);
        expect(ignored("relative.md")).toBe(true);
        expect(reporter).not.toHaveBeenCalled();
    });

    it.each([
        ["add", "onCreate"],
        ["change", "onChange"],
        ["unlink", "onDelete"],
        ["addDir", "onCreate"],
        ["unlinkDir", "onDelete"],
    ] as const)("omits an invalid %s event and still delivers the next valid event", async (event, handler) => {
        const base = path.resolve(path.sep, "vault");
        const reporter = vi.fn();
        const adapter = new CLIStorageEventManagerAdapter(base, undefined, true, reporter);
        const handlers = makeHandlers();
        await adapter.watch.beginWatch(handlers);
        const registration = mockWatcher.on.mock.calls.find(([name]) => name === event);
        const callback = registration?.[1] as ((candidate: string) => void) | undefined;
        if (!callback) {
            throw new Error(`Expected the ${event} handler`);
        }
        const outside = path.resolve(base, "..", "outside");
        callback(outside);
        expect(handlers[handler]).not.toHaveBeenCalled();
        expect(reporter).toHaveBeenCalledWith(expect.stringContaining("ignored"), {
            path: outside,
            vaultPath: base,
        });

        callback(path.join(base, "valid"));
        expect(handlers[handler]).toHaveBeenCalledTimes(1);
        expect(handlers[handler]).toHaveBeenCalledWith(expect.objectContaining({ path: "valid" }));
        expect(reporter).toHaveBeenCalledTimes(1);
    });

    it("preserves folder events for the Vault root", async () => {
        const base = path.resolve(path.sep, "vault");
        const adapter = new CLIStorageEventManagerAdapter(base, undefined, true);
        const handlers = makeHandlers();
        await adapter.watch.beginWatch(handlers);
        const callback = mockWatcher.on.mock.calls.find(([event]) => event === "unlinkDir")?.[1] as (
            candidate: string
        ) => void;
        callback(base);
        expect(handlers.onDelete).toHaveBeenCalledWith(expect.objectContaining({ path: "", isFolder: true }));
    });

    it("beginWatch is no-op when watchEnabled=false", async () => {
        const adapter = new CLIStorageEventManagerAdapter("/base", undefined, false);
        const handlers = makeHandlers();

        await adapter.watch.beginWatch(handlers);

        expect(chokidar.watch).not.toHaveBeenCalled();
    });

    it("beginWatch calls chokidar.watch when watchEnabled=true", async () => {
        const adapter = new CLIStorageEventManagerAdapter("/base", undefined, true);
        const handlers = makeHandlers();

        await adapter.watch.beginWatch(handlers);

        expect(chokidar.watch).toHaveBeenCalledTimes(1);
        expect(chokidar.watch).toHaveBeenCalledWith("/base", expect.objectContaining({ ignoreInitial: true }));
    });

    it("borrows the prepared name source without starting a second watcher", async () => {
        const source = { beginWatch: vi.fn(), close: vi.fn() };
        const adapter = new CLIStorageEventManagerAdapter(
            "/base",
            undefined,
            true,
            undefined,
            undefined,
            undefined,
            source as unknown as CLIFileNameSource
        );
        const handlers = makeHandlers();
        await adapter.watch.beginWatch(handlers);
        expect(source.beginWatch).toHaveBeenCalledWith(handlers);
        expect(chokidar.watch).not.toHaveBeenCalled();
        await adapter.close();
        expect(source.close).toHaveBeenCalledTimes(1);
    });

    it("add event produces NodeFile with correct relative path via onCreate", async () => {
        const basePath = "/vault/base";
        const adapter = new CLIStorageEventManagerAdapter(basePath, undefined, true);
        const handlers = makeHandlers();

        await adapter.watch.beginWatch(handlers);

        // Find the callback registered for the "add" event.
        const addCall = mockWatcher.on.mock.calls.find(([event]) => event === "add");
        expect(addCall).toBeDefined();
        const addCallback = addCall![1] as (filePath: string, stats: any) => void;

        const fakeStats = { ctimeMs: 1000, mtimeMs: 2000, size: 42 };
        addCallback(`${basePath}/subdir/note.md`, fakeStats);

        expect(handlers.onCreate).toHaveBeenCalledTimes(1);
        const created = (handlers.onCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as NodeFile;
        expect(created.path).toBe("subdir/note.md");
        expect(created.stat?.size).toBe(42);
    });

    it("floors sub-millisecond stat timestamps so mobile clients do not receive floats", async () => {
        const basePath = "/vault/base";
        const adapter = new CLIStorageEventManagerAdapter(basePath, undefined, true);
        const handlers = makeHandlers();

        await adapter.watch.beginWatch(handlers);

        const addCallback = mockWatcher.on.mock.calls.find(([event]) => event === "add")![1] as (
            filePath: string,
            stats: any
        ) => void;

        // Linux fs.Stats carry nanosecond-derived sub-millisecond precision.
        const floatStats = { ctimeMs: 1778511180024.462, mtimeMs: 1778511180999.913, size: 7 };
        addCallback(`${basePath}/note.md`, floatStats);

        const created = (handlers.onCreate as ReturnType<typeof vi.fn>).mock.calls[0][0] as NodeFile;
        expect(created.stat?.ctime).toBe(1778511180024);
        expect(created.stat?.mtime).toBe(1778511180999);
    });

    it("keeps creation time across add and change events when inode change time advances", async () => {
        const adapter = new CLIStorageEventManagerAdapter("/vault", undefined, true);
        const handlers = makeHandlers();
        await adapter.watch.beginWatch(handlers);
        const add = mockWatcher.on.mock.calls.find(([event]) => event === "add")![1];
        const change = mockWatcher.on.mock.calls.find(([event]) => event === "change")![1];

        add("/vault/note.md", { birthtimeMs: 1000.9, ctimeMs: 2000.8, mtimeMs: 2000.7, size: 7 });
        change("/vault/note.md", { birthtimeMs: 1000.9, ctimeMs: 3000.8, mtimeMs: 3000.7, size: 8 });

        expect(handlers.onCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                stat: { ctime: 1000, mtime: 2000, size: 7, type: "file" },
            })
        );
        expect(handlers.onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                stat: { ctime: 1000, mtime: 3000, size: 8, type: "file" },
            })
        );
    });

    it("falls back to change time when the filesystem supplies zero birth time", async () => {
        const adapter = new CLIStorageEventManagerAdapter("/vault", undefined, true);
        const handlers = makeHandlers();
        await adapter.watch.beginWatch(handlers);
        const change = mockWatcher.on.mock.calls.find(([event]) => event === "change")![1];
        change("/vault/note.md", { birthtimeMs: 0, ctimeMs: 2000.8, mtimeMs: 3000.7, size: 8 });
        expect(handlers.onChange).toHaveBeenCalledWith(
            expect.objectContaining({
                stat: { ctime: 2000, mtime: 3000, size: 8, type: "file" },
            })
        );
    });

    it("uses the current time for a deletion without stats", async () => {
        const now = vi.spyOn(Date, "now").mockReturnValue(4000);
        try {
            const adapter = new CLIStorageEventManagerAdapter("/vault", undefined, true);
            const handlers = makeHandlers();
            await adapter.watch.beginWatch(handlers);
            const unlink = mockWatcher.on.mock.calls.find(([event]) => event === "unlink")![1];
            unlink("/vault/note.md");
            expect(handlers.onDelete).toHaveBeenCalledWith(
                expect.objectContaining({
                    stat: { ctime: 4000, mtime: 4000, size: 0, type: "file" },
                })
            );
        } finally {
            now.mockRestore();
        }
    });

    it("close() calls watcher.close()", async () => {
        const adapter = new CLIStorageEventManagerAdapter("/base", undefined, true);
        const handlers = makeHandlers();

        await adapter.watch.beginWatch(handlers);
        await adapter.close();

        expect(mockWatcher.close).toHaveBeenCalledTimes(1);
    });

    it("close() is safe when no watcher was started", async () => {
        const adapter = new CLIStorageEventManagerAdapter("/base", undefined, false);

        // Should not throw.
        await expect(adapter.close()).resolves.toBeUndefined();
        expect(mockWatcher.close).not.toHaveBeenCalled();
    });

    it("error event triggers process.exit(1)", async () => {
        const reportDiagnostic = vi.fn();
        const adapter = new CLIStorageEventManagerAdapter("/base", undefined, true, reportDiagnostic);
        const handlers = makeHandlers();

        await adapter.watch.beginWatch(handlers);

        const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

        const errorCall = mockWatcher.on.mock.calls.find(([event]) => event === "error");
        expect(errorCall).toBeDefined();
        const errorCallback = errorCall![1] as (err: Error) => void;

        errorCallback(new Error("disk failure"));

        expect(processExitSpy).toHaveBeenCalledWith(1);
        expect(reportDiagnostic).toHaveBeenCalledWith(
            "[CLIWatchAdapter] Fatal watcher error — file watching stopped:",
            expect.any(Error)
        );
        expect(reportDiagnostic).toHaveBeenCalledWith("[CLIWatchAdapter] Exiting for systemd restart.");

        processExitSpy.mockRestore();
    });
});

describe("CLIStorageEventManagerAdapter type guard", () => {
    const typeGuard = new CLIStorageEventManagerAdapter("/base").typeGuard;

    it.each([
        { label: "null", value: null, expected: false },
        { label: "an object without a path", value: { stat: {} }, expected: false },
        { label: "an object without a stat", value: { path: "note.md" }, expected: false },
        { label: "a file-shaped object", value: { path: "note.md", stat: {} }, expected: true },
        { label: "a folder-shaped object", value: { path: "folder", isFolder: true }, expected: false },
    ])("classifies $label as a file", ({ value, expected }) => {
        expect(typeGuard.isFile(value)).toBe(expected);
    });

    it.each([
        { label: "null", value: null, expected: false },
        { label: "an object without a path", value: { isFolder: true }, expected: false },
        { label: "an object without the folder marker", value: { path: "folder" }, expected: false },
        { label: "a folder-shaped object", value: { path: "folder", isFolder: true }, expected: true },
        { label: "a file-shaped object", value: { path: "note.md", stat: {} }, expected: false },
    ])("classifies $label as a folder", ({ value, expected }) => {
        expect(typeGuard.isFolder(value)).toBe(expected);
    });
});
