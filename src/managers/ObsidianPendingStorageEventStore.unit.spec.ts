import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBKeyValueDatabase } from "@/common/KeyValueDBv2";
import { ObsidianPendingStorageEventStore } from "./ObsidianPendingStorageEventStore";
import type { FileEventItem, FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

const legacyKey = "storage-event-manager-snapshot";
let nextDatabase = 0;
const databases: IDBKeyValueDatabase[] = [];

afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

function setup() {
    const name = `pending-storage-event-buffer-${++nextDatabase}`;
    const database = new IDBKeyValueDatabase(name);
    databases.push(database);
    return { name, database, store: new ObsidianPendingStorageEventStore(() => database) };
}

function changed(path: string): FileEventItem {
    return {
        type: "CHANGED",
        key: path,
        args: { file: { path: path as FilePath, name: path, stat: { size: 1, mtime: 1, ctime: 1, type: "file" } } },
    };
}

describe("Obsidian pending storage event buffers", () => {
    it("loads the legacy array first and keeps each later saved array in order across reopen", async () => {
        const { name, database, store } = setup();
        const legacy = [changed("old-one.md"), changed("old-two.md")];
        const first = [changed("first.md"), changed("second.md")];
        const second = [changed("third.md")];
        await database.set(legacyKey, legacy);
        const firstKey = await store.append(first);
        const secondKey = await store.append(second);
        await database.close();

        const reopened = new IDBKeyValueDatabase(name);
        const reader = new ObsidianPendingStorageEventStore(() => reopened);
        try {
            await expect(reader.load()).resolves.toEqual([
                { key: legacyKey, events: legacy },
                { key: firstKey, events: first },
                { key: secondKey, events: second },
            ]);
            await reader.remove(firstKey);
            await expect(reader.load()).resolves.toEqual([
                { key: legacyKey, events: legacy },
                { key: secondKey, events: second },
            ]);
            await reader.remove(legacyKey);
            await expect(reader.load()).resolves.toEqual([{ key: secondKey, events: second }]);
        } finally {
            await reopened.close();
        }
    });

    it("resolves the current database for each operation", async () => {
        const first = setup();
        const replacement = setup();
        let current = first.database;
        const store = new ObsidianPendingStorageEventStore(() => current);
        const oldEvents = [changed("old.md")];
        const oldKey = await store.append(oldEvents);

        current = replacement.database;
        await expect(store.load()).resolves.toEqual([]);
        const newEvents = [changed("new.md")];
        const newKey = await store.append(newEvents);
        await expect(store.load()).resolves.toEqual([{ key: newKey, events: newEvents }]);
        await store.remove(newKey);
        await expect(store.load()).resolves.toEqual([]);
        await expect(first.store.load()).resolves.toEqual([{ key: oldKey, events: oldEvents }]);
    });

    it("keeps the buffer when deletion succeeds at request level but the transaction aborts", async () => {
        const { store } = setup();
        const events = [changed("pending.md")];
        const key = await store.append(events);
        const deleteRecord = IDBObjectStore.prototype.delete;
        const abortDelete = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
            this: IDBObjectStore,
            query
        ) {
            const request = deleteRecord.call(this, query);
            request.addEventListener("success", () => this.transaction.abort(), { once: true });
            return request;
        });
        try {
            await expect(store.remove(key)).rejects.toMatchObject({ name: "AbortError" });
        } finally {
            abortDelete.mockRestore();
        }
        await expect(store.load()).resolves.toEqual([{ key, events }]);
    });

    it("retains earlier saved buffers when a new buffer cannot be cloned", async () => {
        const { store } = setup();
        const first = [changed("first.md")];
        const key = await store.append(first);
        const uncloneable = changed("bad.md");
        uncloneable.args.ctx = () => undefined;
        await expect(store.append([uncloneable])).rejects.toMatchObject({ name: "DataCloneError" });
        await expect(store.load()).resolves.toEqual([{ key, events: first }]);
        await expect(store.append([changed("next.md")])).resolves.not.toBe(key);
    });
});
