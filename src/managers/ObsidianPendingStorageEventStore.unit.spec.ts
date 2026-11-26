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
const bufferPrefix = "storageEventBuffer/";
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

function timestampKey(timestamp: number, sequence: number): string {
    return `${bufferPrefix}t${String(timestamp).padStart(16, "0")}.${String(sequence).padStart(16, "0")}`;
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

    it("preserves cloneable contexts, event metadata, and sentinels in order across reopen", async () => {
        const { name, database, store } = setup();
        const first = [changed("first.md")];
        const key = await store.append(first);

        const before = changed("before.md");
        const sentinel = { type: "SENTINEL_FLUSH" } as const;
        const withCloneableContext = changed("cloneable-context.md");
        withCloneableContext.args.ctx = { source: "event" };
        withCloneableContext.skipBatchWait = true;
        const after = changed("after.md");
        const events = [before, withCloneableContext, sentinel, after] as const;

        const mixedKey = await store.append(events);

        await database.close();
        const reopened = new IDBKeyValueDatabase(name);
        databases.push(reopened);
        const reader = new ObsidianPendingStorageEventStore(() => reopened);
        await expect(reader.load()).resolves.toEqual([
            { key, events: first },
            { key: mixedKey, events },
        ]);
    });

    it.each(["direct", "nested"] as const)(
        "retains earlier buffers when a %s function context rejects the whole append",
        async (contextKind) => {
            const { store } = setup();
            const now = vi.spyOn(Date, "now").mockReturnValue(1000);
            try {
                const first = [changed("first.md")];
                const key = await store.append(first);
                const uncloneable = changed("bad.md");
                uncloneable.args.ctx = contextKind === "direct" ? () => undefined : { callback: () => undefined };
                await expect(
                    store.append([changed("before-bad.md"), uncloneable, changed("after-bad.md")])
                ).rejects.toMatchObject({ name: "DataCloneError" });
                await expect(store.load()).resolves.toEqual([{ key, events: first }]);

                const next = [changed("next.md")];
                await expect(store.append(next)).resolves.toBe(timestampKey(1000, 3));
                await expect(store.load()).resolves.toEqual([
                    { key, events: first },
                    { key: timestampKey(1000, 3), events: next },
                ]);
            } finally {
                now.mockRestore();
            }
        }
    );

    it("keeps a reset queue safe from a late acknowledgement for the previous buffer", async () => {
        const first = setup();
        const replacement = setup();
        let current = first.database;
        const store = new ObsidianPendingStorageEventStore(() => current);
        const now = vi.spyOn(Date, "now").mockReturnValue(1000);
        try {
            const oldKey = await store.append([changed("old.md")]);
            current = replacement.database;
            const events = [changed("after-reset.md")];
            const newKey = await store.append(events);

            expect(newKey).not.toBe(oldKey);
            await store.remove(oldKey);
            await expect(store.load()).resolves.toEqual([{ key: newKey, events }]);
        } finally {
            now.mockRestore();
        }
    });

    it("replays legacy and decimal buffers before timestamp buffers after reopening with a reversed clock", async () => {
        const { name, database } = setup();
        const legacy = [changed("legacy.md")];
        const decimal = [changed("decimal.md")];
        const persisted = [changed("persisted.md")];
        await database.set(legacyKey, legacy);
        await database.set(`${bufferPrefix}0000000000000008`, decimal);
        await database.set(timestampKey(100000, 7), persisted);
        await database.close();

        const reopened = new IDBKeyValueDatabase(name);
        databases.push(reopened);
        const store = new ObsidianPendingStorageEventStore(() => reopened);
        const now = vi.spyOn(Date, "now").mockReturnValue(500);
        try {
            await expect(store.load()).resolves.toEqual([
                { key: legacyKey, events: legacy },
                { key: `${bufferPrefix}0000000000000008`, events: decimal },
                { key: timestampKey(100000, 7), events: persisted },
            ]);

            const next = [changed("next.md")];
            const nextKey = await store.append(next);
            expect(nextKey).toBe(timestampKey(100001, 1));
            await expect(store.load()).resolves.toEqual([
                { key: legacyKey, events: legacy },
                { key: `${bufferPrefix}0000000000000008`, events: decimal },
                { key: timestampKey(100000, 7), events: persisted },
                { key: nextKey, events: next },
            ]);
        } finally {
            now.mockRestore();
        }
    });

    it("keeps fixed-width same-session ordering across repeated loads and clock rollback", async () => {
        const { store } = setup();
        const now = vi.spyOn(Date, "now").mockReturnValue(700);
        try {
            const firstEvents = [changed("first.md")];
            const secondEvents = [changed("second.md")];
            const firstKey = await store.append(firstEvents);
            const secondKey = await store.append(secondEvents);
            expect(firstKey).toBe(timestampKey(700, 1));
            expect(secondKey).toBe(timestampKey(700, 2));

            await store.load();
            await store.load();
            now.mockReturnValue(600);
            const thirdEvents = [changed("third.md")];
            const thirdKey = await store.append(thirdEvents);

            expect(thirdKey).toBe(timestampKey(700, 3));
            await expect(store.load()).resolves.toEqual([
                { key: firstKey, events: firstEvents },
                { key: secondKey, events: secondEvents },
                { key: thirdKey, events: thirdEvents },
            ]);
        } finally {
            now.mockRestore();
        }
    });

    it("seeds a direct append from persisted keys without reading their values", async () => {
        const { database, store } = setup();
        const legacy = [changed("legacy.md")];
        const decimal = [changed("decimal.md")];
        const persisted = [changed("persisted.md")];
        await database.set(legacyKey, legacy);
        await database.set(`${bufferPrefix}0000000000000008`, decimal);
        await database.set(timestampKey(2000, 3), persisted);

        const get = vi.spyOn(IDBObjectStore.prototype, "get");
        const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
        const getAllKeys = vi.spyOn(IDBObjectStore.prototype, "getAllKeys");
        const openKeyCursor = vi.spyOn(IDBObjectStore.prototype, "openKeyCursor");
        const now = vi.spyOn(Date, "now").mockReturnValue(1000);
        let nextKey = "";
        try {
            nextKey = await store.append([changed("next.md")]);
            expect(nextKey).toBe(timestampKey(2001, 1));
            expect(openKeyCursor).toHaveBeenCalledTimes(1);
            expect(openKeyCursor.mock.calls[0]?.[1]).toBe("prev");
            expect(get).not.toHaveBeenCalled();
            expect(getAll).not.toHaveBeenCalled();
            expect(getAllKeys).not.toHaveBeenCalled();
        } finally {
            get.mockRestore();
            getAll.mockRestore();
            getAllKeys.mockRestore();
            openKeyCursor.mockRestore();
            now.mockRestore();
        }

        await expect(store.load()).resolves.toEqual([
            { key: legacyKey, events: legacy },
            { key: `${bufferPrefix}0000000000000008`, events: decimal },
            { key: timestampKey(2000, 3), events: persisted },
            { key: nextKey, events: [changed("next.md")] },
        ]);
    });
});
