import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { IDBKeyValueDatabase } from "@/common/KeyValueDBv2";
import { ObsidianPendingStorageEventStore } from "./ObsidianPendingStorageEventStore";
import type { FileEventItem, FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";

vi.mock(import("octagonal-wheels/common/logger"), async (importOriginal) => ({
    ...(await importOriginal()),
    Logger: vi.fn(),
}));

const legacyKey = "storage-event-manager-snapshot";
const ignoredItemNotice = "LiveSync ignored an unexpected item while restoring pending file changes.";
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

    it.each([null, undefined, { events: [] }])(
        "discards invalid legacy value %j and restores the new queue",
        async (invalid) => {
            const { database, store } = setup();
            const events = [changed("new.md")];
            const key = await store.append(events);
            await database.set(legacyKey, invalid);
            vi.mocked(Logger).mockClear();

            await expect(store.load()).resolves.toEqual([{ key, events }]);
            expect(await database.keys(legacyKey)).toEqual([]);
            await expect(store.load()).resolves.toEqual([{ key, events }]);
            expect(vi.mocked(Logger).mock.calls.filter(([, level]) => level === LOG_LEVEL_NOTICE)).toEqual([
                [ignoredItemNotice, LOG_LEVEL_NOTICE],
            ]);
        }
    );

    it("continues restoration and only reports once if cleaning up the invalid legacy record fails", async () => {
        const { database, store } = setup();
        const events = [changed("new.md")];
        const key = await store.append(events);
        await database.set(legacyKey, "invalid");
        vi.mocked(Logger).mockClear();
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
            await expect(store.load()).resolves.toEqual([{ key, events }]);
            await expect(store.load()).resolves.toEqual([{ key, events }]);
        } finally {
            abortDelete.mockRestore();
        }
        expect(await database.get(legacyKey)).toBe("invalid");
        expect(vi.mocked(Logger).mock.calls.filter(([, level]) => level === LOG_LEVEL_NOTICE)).toEqual([
            [ignoredItemNotice, LOG_LEVEL_NOTICE],
        ]);
    });

    it("preserves the legacy record if it becomes a valid array before cleanup", async () => {
        const { database, store } = setup();
        const legacy = [changed("old.md")];
        await database.set(legacyKey, "invalid");
        const withStore = database.withStore.bind(database);
        const replaceBeforeCleanup = vi.spyOn(database, "withStore").mockImplementation(async (mode, work) => {
            if (mode === "readwrite") {
                await database.set(legacyKey, legacy);
            }
            return withStore(mode, work);
        });
        try {
            await expect(store.load()).resolves.toEqual([]);
        } finally {
            replaceBeforeCleanup.mockRestore();
        }
        await expect(store.load()).resolves.toEqual([{ key: legacyKey, events: legacy }]);
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
