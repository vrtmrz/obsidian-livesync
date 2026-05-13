import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IStorageEventWatchHandlers } from "@lib/managers/adapters";
import type { NodeFile } from "../adapters/NodeTypes";

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
        expect(chokidar.watch).toHaveBeenCalledWith(
            "/base",
            expect.objectContaining({ ignoreInitial: true })
        );
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
        const adapter = new CLIStorageEventManagerAdapter("/base", undefined, true);
        const handlers = makeHandlers();

        await adapter.watch.beginWatch(handlers);

        const processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

        const errorCall = mockWatcher.on.mock.calls.find(([event]) => event === "error");
        expect(errorCall).toBeDefined();
        const errorCallback = errorCall![1] as (err: Error) => void;

        errorCallback(new Error("disk failure"));

        expect(processExitSpy).toHaveBeenCalledWith(1);

        processExitSpy.mockRestore();
    });
});
