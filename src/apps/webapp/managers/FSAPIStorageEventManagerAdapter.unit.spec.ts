import { IDBDatabase, IDBFactory, IDBObjectStore, IDBTransaction } from "fake-indexeddb";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import type { WebAppLog } from "../WebAppLog";
import { FSAPIStorageEventManagerAdapter } from "./FSAPIStorageEventManagerAdapter";

describe("FSAPIStorageEventManagerAdapter type guard", () => {
    const typeGuard = new FSAPIStorageEventManagerAdapter({} as FileSystemDirectoryHandle, vi.fn()).typeGuard;

    it.each([
        { label: "null", value: null, expected: false },
        { label: "an object without a path", value: { stat: {}, handle: undefined }, expected: false },
        { label: "an object without a stat", value: { path: "note.md", handle: undefined }, expected: false },
        { label: "an object without a handle", value: { path: "note.md", stat: {} }, expected: false },
        {
            label: "a file-shaped object with a handle property",
            value: { path: "note.md", stat: {}, handle: undefined },
            expected: true,
        },
        {
            label: "a folder-shaped object",
            value: { path: "folder", handle: undefined, isFolder: true },
            expected: false,
        },
    ])("classifies $label as a file", ({ value, expected }) => {
        expect(typeGuard.isFile(value)).toBe(expected);
    });

    it.each([
        { label: "null", value: null, expected: false },
        { label: "an object without a path", value: { isFolder: true, handle: undefined }, expected: false },
        { label: "an object without the folder marker", value: { path: "folder", handle: undefined }, expected: false },
        { label: "an object without a handle", value: { path: "folder", isFolder: true }, expected: false },
        {
            label: "a folder-shaped object with a handle property",
            value: { path: "folder", isFolder: true, handle: undefined },
            expected: true,
        },
        { label: "a file-shaped object", value: { path: "note.md", stat: {}, handle: undefined }, expected: false },
    ])("classifies $label as a folder", ({ value, expected }) => {
        expect(typeGuard.isFolder(value)).toBe(expected);
    });
});

describe("FSAPIStorageEventManagerAdapter snapshot durability", () => {
    const snapshot = [{ type: "SENTINEL_FLUSH" }] as const;
    let indexedDB: IDBFactory;
    let close: MockInstance<IDBDatabase["close"]>;
    let addLog: Mock<WebAppLog>;
    let persistence: FSAPIStorageEventManagerAdapter["persistence"];

    beforeEach(() => {
        indexedDB = new IDBFactory();
        vi.stubGlobal("indexedDB", indexedDB);
        close = vi.spyOn(IDBDatabase.prototype, "close");
        addLog = vi.fn<WebAppLog>();
        persistence = new FSAPIStorageEventManagerAdapter({} as FileSystemDirectoryHandle, addLog).persistence;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function openSnapshotDatabase(version: number): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open("livesync-webapp-snapshot", version);
            request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    it("round-trips a committed snapshot and closes both database handles", async () => {
        const committed = vi.fn();
        const originalPut = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
            this: IDBObjectStore,
            ...args: Parameters<IDBObjectStore["put"]>
        ) {
            this.transaction.addEventListener("complete", committed);
            return originalPut.apply(this, args);
        });

        await persistence.saveSnapshot([...snapshot]);
        expect(committed).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledExactlyOnceWith();
        await expect(persistence.loadSnapshot()).resolves.toEqual(snapshot);
        expect(close).toHaveBeenCalledTimes(2);
    });

    it("returns null on a committed read of a missing snapshot and closes the database", async () => {
        await expect(persistence.loadSnapshot()).resolves.toBeNull();
        expect(close).toHaveBeenCalledOnce();
    });

    it("rejects and logs a write aborted after request success, preserving the previous snapshot", async () => {
        await persistence.saveSnapshot([...snapshot]);
        close.mockClear();
        const requestSucceeded = vi.fn();
        const originalPut = IDBObjectStore.prototype.put;
        vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
            this: IDBObjectStore,
            ...args: Parameters<IDBObjectStore["put"]>
        ) {
            const request = originalPut.apply(this, args);
            request.addEventListener("success", () => {
                requestSucceeded();
                this.transaction.abort();
            });
            return request;
        });

        await expect(persistence.saveSnapshot([])).rejects.toThrow();
        expect(requestSucceeded).toHaveBeenCalledOnce();
        expect(addLog).toHaveBeenCalledWith(
            expect.stringContaining("Failed to save snapshot"),
            LOG_LEVEL_NOTICE,
            "fsapi-snapshot"
        );
        expect(close).toHaveBeenCalledOnce();
        await expect(persistence.loadSnapshot()).resolves.toEqual(snapshot);
    });

    it("rejects a read aborted after request success and closes the database", async () => {
        const requestSucceeded = vi.fn();
        const originalGet = IDBObjectStore.prototype.getAll;
        vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementationOnce(function (this: IDBObjectStore, ...args) {
            const request = originalGet.apply(this, args);
            request.addEventListener("success", () => {
                requestSucceeded();
                this.transaction.abort();
            });
            return request;
        });

        await expect(persistence.loadSnapshot()).rejects.toThrow();
        expect(requestSucceeded).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });

    it.each(["put", "getAll"] as const)("aborts and closes after a synchronous %s failure", async (method) => {
        const error = new DOMException("Cannot construct snapshot request", "DataCloneError");
        const abort = vi.spyOn(IDBTransaction.prototype, "abort");
        vi.spyOn(IDBObjectStore.prototype, method).mockImplementationOnce(() => {
            throw error;
        });
        const operation = method === "put" ? persistence.saveSnapshot([]) : persistence.loadSnapshot();

        await expect(operation).rejects.toBe(error);
        expect(abort).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        if (method === "put") {
            expect(addLog).toHaveBeenCalledWith(
                expect.stringContaining(error.message),
                LOG_LEVEL_NOTICE,
                "fsapi-snapshot"
            );
        }
    });

    it("rejects a failed read request with its error and closes the database", async () => {
        const originalGet = IDBObjectStore.prototype.getAll;
        vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementationOnce(function (this: IDBObjectStore, ...args) {
            const request = originalGet.apply(this, args);
            this.transaction.abort();
            return request;
        });

        await expect(persistence.loadSnapshot()).rejects.toMatchObject({ name: "AbortError" });
        expect(close).toHaveBeenCalledOnce();
    });

    it.each([undefined, null, { unexpected: true }])(
        "rejects a stored non-array value (%j) and closes the database",
        async (value) => {
            const db = await openSnapshotDatabase(1);
            await new Promise<void>((resolve, reject) => {
                const transaction = db.transaction("snapshots", "readwrite");
                transaction.oncomplete = () => resolve();
                transaction.onabort = transaction.onerror = () => reject(transaction.error);
                transaction.objectStore("snapshots").put(value, "file-events");
            });
            db.close();
            close.mockClear();

            await expect(persistence.loadSnapshot()).rejects.toThrow(/array/i);
            expect(close).toHaveBeenCalledOnce();
        }
    );

    it.each([{}, { type: "CHANGED", args: {} }])("rejects malformed events in stored arrays (%j)", async (event) => {
        await persistence.saveSnapshot([event] as never);
        await expect(persistence.loadSnapshot()).rejects.toThrow("Invalid event in the WebApp storage-event snapshot");
    });

    it.each(["isInternal", "deleted"])("rejects a non-boolean %s flag", async (flag) => {
        const file = {
            path: "retained.md",
            name: "retained.md",
            stat: { type: "file", ctime: 1, mtime: 1, size: 1 },
            [flag]: "false",
        };
        await persistence.saveSnapshot([{ type: "CHANGED", key: file.path, args: { file } }] as never);

        await expect(persistence.loadSnapshot()).rejects.toThrow("Invalid event in the WebApp storage-event snapshot");
    });

    it("rejects reads and writes when opening the database fails", async () => {
        const db = await openSnapshotDatabase(2);
        db.close();
        close.mockClear();

        await expect(persistence.loadSnapshot()).rejects.toMatchObject({ name: "VersionError" });
        await expect(persistence.saveSnapshot([])).rejects.toMatchObject({ name: "VersionError" });
        expect(addLog).toHaveBeenCalledWith(
            expect.stringContaining("VersionError"),
            LOG_LEVEL_NOTICE,
            "fsapi-snapshot"
        );
        expect(close).not.toHaveBeenCalled();
    });
});
