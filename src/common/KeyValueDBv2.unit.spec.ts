import "fake-indexeddb/auto";
import { forceCloseDatabase } from "fake-indexeddb";
import { openDB, unwrap } from "idb";
import { expect, it, vi } from "vitest";
import { IDBKeyValueDatabase, KeyValueDatabaseOwner, OpenKeyValueDatabase } from "./KeyValueDBv2";

it("rolls back the whole batch when a later put cannot be cloned", async () => {
    const db = new IDBKeyValueDatabase("batch-rollback");
    try {
        await db.set("existing", "original");
        await expect(
            db.applyBatch([
                { type: "put", key: "existing", value: "changed" },
                { type: "put", key: "new", value: () => undefined },
            ])
        ).rejects.toMatchObject({ name: "DataCloneError" });
        expect(await db.get("existing")).toBe("original");
        expect(await db.keys()).toEqual(["existing"]);
    } finally {
        await db.destroy();
    }
});

it("isolates owners opening the same physical store", async () => {
    const old = await OpenKeyValueDatabase("close-isolation");
    const next = await OpenKeyValueDatabase("close-isolation");
    try {
        const liveConnection = await next.DB;
        const closeLiveConnection = vi.spyOn(liveConnection, "close");
        await old.close();
        expect(closeLiveConnection).not.toHaveBeenCalled();
        expect(await next.DB).toBe(liveConnection);
        await next.set("new", true);
        expect(await next.get("new")).toBe(true);
    } finally {
        await next.destroy();
    }
});

it("resolves a batch after completion, and enumerates a bounded range in key order", async () => {
    const db = new IDBKeyValueDatabase("batch-commit-order");
    const events: string[] = [];
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<typeof originalPut>
    ) {
        const request = originalPut.apply(this, args);
        request.addEventListener("success", () => events.push("success"));
        this.transaction.addEventListener("complete", () => events.push("commit"));
        return request;
    });
    try {
        await db.applyBatch([{ type: "put", key: ["entry", 20], value: "twenty" }]);
        events.push("resolved");
        expect(events).toEqual(["success", "commit", "resolved"]);
        put.mockRestore();
        await db.applyBatch([
            { type: "put", key: ["entry", 10], value: "ten" },
            { type: "put", key: ["entry", 2], value: "two" },
            { type: "put", key: ["entry", 100], value: "hundred" },
            { type: "put", key: "entry-5", value: "string" },
            { type: "delete", key: ["entry", 20] },
        ]);
        await expect(db.getEntries(IDBKeyRange.bound(["entry", 2], ["entry", 100]), 2)).resolves.toEqual([
            { key: ["entry", 2], value: "two" },
            { key: ["entry", 10], value: "ten" },
        ]);
    } finally {
        put.mockRestore();
        await db.destroy();
    }
});

it("waits for a concurrent close before reopening the same wrapper", async () => {
    const db = new IDBKeyValueDatabase("close-reopen");
    try {
        const first = await db.DB;
        const closing = db.close();
        const opening = db.DB;
        await closing;
        const next = await opening;
        expect(next).not.toBe(first);
        expect(await db.DB).toBe(next);
        await db.set("still-open", 1);
        await expect(db.get("still-open")).resolves.toBe(1);
    } finally {
        await db.destroy();
    }
});

it("closes a pending open when its owner retires and lets a successor open the same store", async () => {
    const key = "retire-pending-open";
    const owner = new KeyValueDatabaseOwner(vi.fn());
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    const opening = owner.open(key);
    const retired = owner.retire(() => Promise.resolve());
    let replacement: IDBKeyValueDatabase | undefined;

    try {
        await expect(opening).rejects.toThrow("Key-value database owner is retiring");
        await expect(retired).resolves.toBeUndefined();
        expect(close).toHaveBeenCalledOnce();

        replacement = await new KeyValueDatabaseOwner(vi.fn()).open(key);
        await replacement.set("still-open", true);
        await expect(replacement.get("still-open")).resolves.toBe(true);
    } finally {
        close.mockRestore();
        await retired;
        await (replacement ?? new IDBKeyValueDatabase(key)).destroy();
    }
});

it("rejects destruction by a retired handle without deleting the successor's data", async () => {
    const key = "retire-then-destroy";
    const owner = new KeyValueDatabaseOwner(vi.fn());
    const retired = await owner.open(key);
    await owner.retire(async () => {});
    const successor = await new KeyValueDatabaseOwner(vi.fn()).open(key);
    try {
        await successor.set("pending", "successor");
        await expect(retired.destroy()).rejects.toThrow("Key-value database is closed");
        await expect(successor.get("pending")).resolves.toBe("successor");

        const destroying = successor.destroy();
        expect(successor.destroy()).toBe(destroying);
        await destroying;
    } finally {
        await successor.destroy();
    }
});

it.each([false, true])("supports signals without throwIfAborted (aborted=%s)", async (aborted) => {
    const db = new IDBKeyValueDatabase("old-abort-api");
    const signal = Object.assign(new EventTarget(), { aborted }) as AbortSignal;
    try {
        const write = db.applyBatch([{ type: "put", key: "committed", value: true }], undefined, signal);
        if (aborted) {
            await expect(write).rejects.toThrow("Operation aborted");
            await expect(db.keys()).resolves.toEqual([]);
        } else {
            await expect(write).resolves.toBeUndefined();
            await expect(db.get("committed")).resolves.toBe(true);
        }
    } finally {
        await db.destroy();
    }
});

it("can reopen the same wrapper after its initial open is rejected", async () => {
    const key = "retry-failed-open";
    const seeded = await openDB(key, 2, { upgrade: (db) => db.createObjectStore(key) });
    seeded.close();
    const open = indexedDB.open.bind(indexedDB);
    const failFirstOpen = vi.spyOn(indexedDB, "open").mockImplementationOnce((name) => open(name, 1));
    const db = new IDBKeyValueDatabase(key);

    try {
        await expect(db.getIsReady()).rejects.toMatchObject({ name: "VersionError" });
        expect(failFirstOpen).toHaveBeenCalledOnce();
        await expect(db.getIsReady()).resolves.toBe(true);
        await db.set("reopened", 1);
        await expect(db.get("reopened")).resolves.toBe(1);
    } finally {
        failFirstOpen.mockRestore();
        await db.destroy();
    }
});

it("opens a fresh connection when the retained connection is terminated", async () => {
    const db = new IDBKeyValueDatabase("reopen-after-termination");
    try {
        await db.set("retained", "value");
        const first = await db.DB;
        // fake-indexeddb declares a constructor parameter, but its implementation closes an instance.
        forceCloseDatabase(unwrap(first) as unknown as Parameters<typeof forceCloseDatabase>[0]);

        await expect(db.get("retained")).resolves.toBe("value");
        expect(await db.DB).not.toBe(first);
    } finally {
        await db.destroy();
    }
});

it("propagates an aborted read transaction from getEntries", async () => {
    const db = new IDBKeyValueDatabase("get-entries-read-failure");
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    try {
        await db.set("retained", "value");
        getAll.mockImplementationOnce(function (this: IDBObjectStore, ...args) {
            // The one-shot override is already consumed, so this call uses the native method.
            const request = this.getAll(...args);
            request.addEventListener("success", () => this.transaction.abort());
            return request;
        });

        await expect(db.getEntries()).rejects.toMatchObject({ name: "AbortError" });
        await expect(db.getEntries()).resolves.toEqual([{ key: "retained", value: "value" }]);
    } finally {
        getAll.mockRestore();
        await db.destroy();
    }
});
