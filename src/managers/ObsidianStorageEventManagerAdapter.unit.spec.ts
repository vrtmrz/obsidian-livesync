import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { readCommittedStorageEventSnapshotSource } from "../../test/e2e-obsidian/runner/committedStorageEventSnapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import type { FileEventItem, FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type {
    QueuedFileEvent,
    StorageEventManagerBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import type { StorageEventSnapshotRecord } from "@vrtmrz/livesync-commonlib/storage";
import { bailFirstFailureFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/HandlerUtils";
import { IDBKeyValueDatabase, OpenKeyValueDatabase } from "@/common/KeyValueDBv2";
import { ObsidianDatabaseEventService, ObsidianKeyValueDBService } from "@/modules/services/ObsidianServices";
import { ObsidianPersistenceAdapter, StorageEventPersistenceInterrupted } from "./ObsidianStorageEventManagerAdapter";
import { StorageEventManagerObsidian } from "./StorageEventManagerObsidian";

vi.mock("@/deps", () => ({ TFile: class {}, TFolder: class {} }));

const legacyKey = "storage-event-manager-snapshot";
const metaKey = ["storage-event-manager-meta", "state"];
const entryKey = (sequence: number) => ["storage-event-manager-entry", sequence];
const entryRange = () => IDBKeyRange.bound(entryKey(1), ["storage-event-manager-entry", []], false, true);

let nextDatabase = 0;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    vi.restoreAllMocks();
    for (const run of cleanup.splice(0).reverse()) await run();
});

async function openStore() {
    const key = `snapshot-test-${++nextDatabase}`;
    const store = await OpenKeyValueDatabase(key);
    cleanup.push(() => store.destroy());
    return { key, store, adapter: new ObsidianPersistenceAdapter(() => store) };
}

function changed(path: string): FileEventItem {
    return {
        type: "CHANGED",
        key: path,
        args: { file: { path: path as FilePath, name: path, stat: { size: 1, mtime: 1, ctime: 1, type: "file" } } },
    };
}

function legacyEvents(length: number) {
    const events: QueuedFileEvent[] = [];
    const expected: StorageEventSnapshotRecord[] = [];
    const cache = [128, 1_024, 4_096, 16_384].map((size) => "a".repeat(size));
    for (let index = 0; index < length; index++) {
        const intent = changed(`duplicate-${index % 41}.md`);
        intent.args.ctx = { index };
        if (index % 5 === 0) {
            intent.type = "DELETE";
            intent.args.renameTarget = `filtered-${index}.txt`;
        }
        const event: QueuedFileEvent = index % 17 === 0 ? { type: "SENTINEL_FLUSH" } : intent;
        expected.push({ id: String(index + 1).padStart(12, "0"), event });
        events.push(
            event.type === "SENTINEL_FLUSH"
                ? event
                : {
                      ...event,
                      args: { ...event.args, cache: cache[index % cache.length] },
                      restoredFromPreviousRuntime: true,
                      skipBatchWait: true,
                  }
        );
    }
    return { events, expected };
}

async function openService() {
    const name = `snapshot-service-test-${++nextDatabase}`;
    const context = {} as never;
    const databaseEvents = new ObsidianDatabaseEventService(context);
    const appLifecycle = {
        onSettingLoaded: bailFirstFailureFunction<() => Promise<boolean>>("load settings"),
        onUnload: bailFirstFailureFunction<() => Promise<boolean>>("unload"),
    };
    const service = new ObsidianKeyValueDBService(context, {
        appLifecycle: appLifecycle as never,
        databaseEvents,
        vault: { getVaultName: () => name } as never,
    });
    expect(await appLifecycle.onSettingLoaded()).toBe(true);
    const store = service.kvDB;
    if (!(store instanceof IDBKeyValueDatabase)) throw new Error("Expected an IndexedDB store");
    cleanup.push(async () => {
        await service.kvDB.destroy();
    });
    return { service, databaseEvents, store };
}

describe("Obsidian incremental storage-event snapshots", () => {
    it.each(["legacy", "active"] as const)(
        "supplies a missing queue key from a snapshot in %s format",
        async (format) => {
            const { store, adapter } = await openStore();
            const intent = changed("retained.md");
            const stored = {
                type: "DELETE",
                cancelled: false,
                args: { file: { ...intent.args.file, isInternal: false, deleted: true }, renameTarget: "filtered.md" },
            };
            const expected = { ...stored, key: intent.key };
            const id = "000000000001";
            if (format === "legacy") {
                await store.set(legacyKey, [stored]);
            } else {
                await store.set(metaKey, { format: "incremental-v1", highWaterSequence: 1 });
                await store.set(entryKey(1), { id, event: stored });
            }

            await expect(adapter.loadSnapshotEntries()).resolves.toEqual([{ id, event: expected }]);
            await expect(store.get(entryKey(1))).resolves.toEqual({
                id,
                event: format === "legacy" ? expected : stored,
            });
            await expect(store.get(legacyKey)).resolves.toBeUndefined();
        }
    );

    it("migrates all 7,453 events in bounded batches and preserves the exact sanitised intent order", async () => {
        const { key, store } = await openStore();
        const { events, expected } = legacyEvents(7_453);
        await store.set(legacyKey, events);
        const batch = vi.spyOn(store, "applyBatch");
        const onBeforeStagingChunk = vi.fn();
        const adapter = new ObsidianPersistenceAdapter(() => store, { onBeforeStagingChunk });

        await expect(adapter.loadSnapshotEntries()).resolves.toEqual(expected);
        expect(onBeforeStagingChunk).toHaveBeenCalledTimes(38);
        expect(Math.max(...batch.mock.calls.map(([operations]) => operations.length))).toBe(200);
        expect(batch).toHaveBeenCalledTimes(39);
        await expect(adapter.loadSnapshot()).resolves.toBeNull();
        await expect(store.get(metaKey)).resolves.toEqual({
            format: "incremental-v1",
            highWaterSequence: events.length,
            storeId: expect.any(String),
        });
        await store.close();
        const reopened = await OpenKeyValueDatabase(key);
        try {
            const recovered = new ObsidianPersistenceAdapter(() => reopened);
            await expect(recovered.loadSnapshotEntries()).resolves.toEqual(expected);
        } finally {
            await reopened.close();
        }
    });

    it.each([3, 6, 9])("resumes after interruption with %i staged events", async (offset) => {
        const { key, store } = await openStore();
        const { events, expected } = legacyEvents(11);
        await store.set(legacyKey, events);
        await store.set(entryKey(50), { id: "stray", event: changed("stray.md") });
        const interrupted = new ObsidianPersistenceAdapter(() => store, {
            migrationChunkSize: 3,
            onBeforeStagingChunk: (index) => {
                if (index === offset) interrupted.abortRestore();
            },
        });

        await expect(interrupted.loadSnapshotEntries()).rejects.toBeInstanceOf(StorageEventPersistenceInterrupted);
        expect(await store.get(legacyKey)).toEqual(events);
        expect(await store.get(metaKey)).toBeUndefined();
        expect(await store.keys(entryRange())).toEqual([
            ...Array.from({ length: offset }, (_, i) => entryKey(i + 1)),
            entryKey(50),
        ]);

        await store.close();
        const reopened = await OpenKeyValueDatabase(key);
        try {
            await expect(new ObsidianPersistenceAdapter(() => reopened).loadSnapshotEntries()).resolves.toEqual(
                expected
            );
            expect(await reopened.get(legacyKey)).toBeUndefined();
            expect(await reopened.get(entryKey(50))).toBeUndefined();
        } finally {
            await reopened.close();
        }
    });

    it.each(["before", "during", "after"] as const)("recovers if interrupted %s cutover", async (phase) => {
        const { key, store } = await openStore();
        const { events, expected } = legacyEvents(7);
        await store.set(legacyKey, events);
        const interrupted = new ObsidianPersistenceAdapter(() => store, {
            onBeforeCutover: () => {
                if (phase === "before") interrupted.abortRestore();
            },
        });
        const isMeta = (key: IDBValidKey | undefined) => Array.isArray(key) && key[0] === metaKey[0];
        if (phase === "during") {
            const put = IDBObjectStore.prototype.put;
            vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
                const request = put.call(this, value, key);
                if (isMeta(key)) request.addEventListener("success", () => interrupted.abortRestore());
                return request;
            });
        } else if (phase === "after") {
            const applyBatch = store.applyBatch.bind(store);
            vi.spyOn(store, "applyBatch").mockImplementation(async (batch, check, signal) => {
                await applyBatch(batch, check, signal);
                if (batch.some(({ key }) => isMeta(key))) interrupted.abortRestore();
            });
        }

        await expect(interrupted.loadSnapshotEntries()).rejects.toBeInstanceOf(StorageEventPersistenceInterrupted);
        vi.restoreAllMocks();
        expect(await store.get(legacyKey)).toEqual(phase === "after" ? undefined : events);
        expect(await store.get(metaKey)).toEqual(
            phase === "after"
                ? { format: "incremental-v1", highWaterSequence: events.length, storeId: expect.any(String) }
                : undefined
        );

        await store.close();
        const reopened = await OpenKeyValueDatabase(key);
        try {
            await expect(new ObsidianPersistenceAdapter(() => reopened).loadSnapshotEntries()).resolves.toEqual(
                expected
            );
            expect(await reopened.get(legacyKey)).toBeUndefined();
        } finally {
            await reopened.close();
        }
    });

    it("distinguishes absent, corrupt legacy, staged, and active-empty snapshots", async () => {
        const { store, adapter } = await openStore();
        await expect(adapter.loadSnapshotEntries()).resolves.toBeNull();
        await expect(adapter.loadSnapshot()).resolves.toBeNull();
        await store.set(legacyKey, undefined);
        await expect(adapter.loadSnapshotEntries()).rejects.toThrow("Invalid legacy storage event snapshot");
        await expect(adapter.loadSnapshot()).rejects.toThrow("Invalid legacy storage event snapshot");
        await expect(adapter.applySnapshotDelta({ upsert: [], remove: [] })).rejects.toThrow("must be migrated");
        await adapter.saveSnapshot([]);
        await expect(adapter.loadSnapshot()).resolves.toEqual([]);
        await expect(adapter.loadSnapshotEntries()).resolves.toEqual([]);
        await expect(adapter.loadSnapshot()).resolves.toBeNull();
        await expect(adapter.saveSnapshot([changed("stale.md")])).rejects.toThrow("already staged or incremental");
        expect(await store.get(metaKey)).toEqual({
            format: "incremental-v1",
            highWaterSequence: 0,
            storeId: expect.any(String),
        });
    });

    it.each([false, true])(
        "preserves incremental deletions on re-upgrade with legacy additions=%s",
        async (hasAdditions) => {
            const { key, store, adapter } = await openStore();
            const pending = { id: "000000000003", event: { ...changed("deleted.md"), type: "DELETE" } as const };
            const acknowledged = { id: "already-processed", event: changed("processed.md") };
            await adapter.applySnapshotDelta({ upsert: [pending, acknowledged], remove: [] });
            await adapter.applySnapshotDelta({ upsert: [], remove: [acknowledged.id] });
            const addition = { type: "CREATE", args: changed("created.md").args };
            await store.set(legacyKey, hasAdditions ? [addition] : []);
            const readCommitted = new Function("return (" + readCommittedStorageEventSnapshotSource + ")")() as (
                name: string
            ) => Promise<{ events: unknown }>;
            await expect(readCommitted(key)).resolves.toMatchObject({
                events: hasAdditions ? [pending.event, addition] : [pending.event],
            });

            const reopened = await OpenKeyValueDatabase(key);
            try {
                const batch = vi.spyOn(reopened, "applyBatch");
                const restored = await new ObsidianPersistenceAdapter(() => reopened).loadSnapshotEntries();
                expect(restored?.map(({ event }) => event)).toEqual(
                    hasAdditions ? [pending.event, { ...addition, key: addition.args.file.path }] : [pending.event]
                );
                expect(restored?.[0]).toEqual(pending);
                expect(new Set(restored?.map(({ id }) => id)).size).toBe(restored?.length);
                await expect(reopened.keys(entryRange())).resolves.toEqual(
                    hasAdditions ? [entryKey(1), entryKey(3)] : [entryKey(1)]
                );
                await expect(reopened.get(metaKey)).resolves.toEqual({
                    format: "incremental-v1",
                    highWaterSequence: hasAdditions ? 3 : 2,
                    storeId: expect.any(String),
                });
                await expect(reopened.keys(legacyKey)).resolves.toEqual([]);
                expect(batch).toHaveBeenCalledOnce();
                if (!hasAdditions) {
                    expect(batch.mock.calls[0][0]).toEqual([{ type: "delete", key: legacyKey }]);
                }
            } finally {
                await reopened.close();
            }
        }
    );

    const intentWithFlags = changed("flags.md");
    const file = intentWithFlags.args.file;
    it.each([
        {},
        { type: "CHANGED", args: {} },
        { ...changed("old.md"), type: "RENAME" },
        { ...intentWithFlags, cancelled: "false" },
        { ...intentWithFlags, batched: "false" },
        { ...intentWithFlags, skipBatchWait: "false" },
        { ...intentWithFlags, args: { file: { ...file, isFolder: true } } },
        { ...intentWithFlags, args: { file: { ...file, name: undefined } } },
        { ...intentWithFlags, args: { file: { ...file, stat: undefined } } },
        { ...intentWithFlags, args: { file: { ...file, stat: { ...file.stat, size: Infinity } } } },
        { ...intentWithFlags, args: { file, oldPath: 42 } },
        { ...intentWithFlags, args: { file, renameTarget: null } },
        ...(["isInternal", "deleted"] as const).map((flag) => ({
            ...intentWithFlags,
            args: { file: { ...intentWithFlags.args.file, [flag]: "false" } },
        })),
    ])("rejects malformed event %j in both formats before changing records", async (malformed) => {
        const { store, adapter } = await openStore();
        const legacy = [changed("valid.md"), malformed];
        await store.set(legacyKey, legacy);
        await expect(adapter.loadSnapshotEntries()).rejects.toThrow("Invalid legacy storage event snapshot");
        await expect(store.get(legacyKey)).resolves.toEqual(legacy);
        await expect(store.keys(entryRange())).resolves.toEqual([]);

        await store.del(legacyKey);
        await store.set(metaKey, { format: "incremental-v1", highWaterSequence: 1 });
        await store.set(entryKey(1), { id: "1", event: malformed });
        await expect(adapter.loadSnapshotEntries()).rejects.toThrow("Invalid incremental storage event record");
    });

    it("migrates an internal event without a file stat", async () => {
        const { store, adapter } = await openStore();
        const event = { ...intentWithFlags, type: "INTERNAL", args: { file: { ...file, stat: undefined } } };
        await store.set(legacyKey, [event]);

        await expect(adapter.loadSnapshotEntries()).resolves.toEqual([{ id: "000000000001", event }]);
        await expect(store.get(legacyKey)).resolves.toBeUndefined();
    });

    it("rejects orphaned entries when neither format is marked", async () => {
        const { store, adapter } = await openStore();
        await store.set(entryKey(2), { id: "2", event: changed("orphan.md") });
        await expect(adapter.loadSnapshotEntries()).rejects.toThrow("Orphaned incremental storage event records");
    });

    it.each<[IDBValidKey]>([[0], [-1], ["invalid"], [[]]])(
        "rejects a malformed physical sequence %j in active storage",
        async (sequence) => {
            const { store, adapter } = await openStore();
            await store.set(metaKey, { format: "incremental-v1", highWaterSequence: 1 });
            await store.set(["storage-event-manager-entry", sequence], { id: "invalid", event: changed("invalid.md") });
            await expect(adapter.loadSnapshotEntries()).rejects.toThrow("Invalid incremental storage event record");
        }
    );

    it.each([false, true])("migrates with a pre-15.4 AbortSignal (aborted=%s)", async (aborted) => {
        const { store } = await openStore();
        const { events, expected } = legacyEvents(2);
        await store.set(legacyKey, events);
        vi.stubGlobal(
            "AbortController",
            class {
                readonly signal = Object.assign(new EventTarget(), { aborted });
            }
        );
        try {
            const result = new ObsidianPersistenceAdapter(() => store).loadSnapshotEntries();
            if (aborted) {
                await expect(result).rejects.toThrow("Operation aborted");
                await expect(store.get(legacyKey)).resolves.toEqual(events);
                await expect(store.get(metaKey)).resolves.toBeUndefined();
            } else {
                await expect(result).resolves.toEqual(expected);
            }
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("fences an acknowledgement and reloads its index after native database deletion", async () => {
        const { store, adapter } = await openStore();
        const old = { id: "old", event: changed("old.md") };
        const replacement = { id: "new", event: changed("new.md") };
        await adapter.applySnapshotDelta({ upsert: [old], remove: [] });
        const reached = promiseWithResolvers<void>();
        const release = promiseWithResolvers<void>();
        const apply = store.applyBatch.bind(store);
        vi.spyOn(store, "applyBatch").mockImplementationOnce(async (batch, check, signal) => {
            reached.resolve();
            await release.promise;
            await apply(batch, check, signal);
        });
        const acknowledgement = adapter.applySnapshotDelta({ upsert: [], remove: [old.id] });
        void acknowledgement.catch(() => undefined);
        try {
            await reached.promise;
            await deleteDB((await store.DB).name);
            const next = new ObsidianPersistenceAdapter(() => store);
            await next.applySnapshotDelta({ upsert: [replacement], remove: [] });
            release.resolve();
            await expect(acknowledgement).rejects.toBeInstanceOf(StorageEventPersistenceInterrupted);

            await adapter.applySnapshotDelta({ upsert: [], remove: [old.id] });
            await expect(next.loadSnapshotEntries()).resolves.toEqual([replacement]);
            await expect(store.get(entryKey(1))).resolves.toEqual(replacement);
        } finally {
            release.resolve();
            await acknowledgement.catch(() => undefined);
        }
    });

    it("notifies the owned persistence generation when a native connection is replaced", async () => {
        const { store, service } = await openService();
        const reset = vi.fn(async () => {});
        service.onStoreReplacement(reset);
        const name = (await store.DB).name;
        await deleteDB(name);
        expect(reset).toHaveBeenCalledOnce();
        await expect(store.set("recreated", true)).resolves.toBe("recreated");
    });

    it("allocates from committed physical metadata across failures, retries, and an active-empty restart", async () => {
        const { key, store, adapter } = await openStore();
        const id = "000000000001";
        const first = { id, event: changed("first.md") };
        await adapter.applySnapshotDelta({ upsert: [first], remove: [] });
        const revised = { id, event: changed("revised.md") };
        const uncloneable = changed("invalid.md");
        uncloneable.args.ctx = () => undefined;
        const invalid = { id: "new", event: uncloneable };
        await expect(adapter.applySnapshotDelta({ upsert: [revised, invalid], remove: [] })).rejects.toMatchObject({
            name: "DataCloneError",
        });
        await expect(adapter.applySnapshotDelta({ upsert: [revised], remove: [id] })).rejects.toThrow("same ID");
        expect(await store.get(entryKey(1))).toEqual(first);
        expect(await store.get(metaKey)).toEqual({
            format: "incremental-v1",
            highWaterSequence: 1,
            storeId: expect.any(String),
        });
        await adapter.applySnapshotDelta({ upsert: [revised, { id: "new", event: changed("new.md") }], remove: [] });
        expect(await store.get(entryKey(1))).toEqual(revised);
        expect(await store.keys(entryRange())).toEqual([entryKey(1), entryKey(2)]);

        await adapter.applySnapshotDelta({ upsert: [], remove: [id, "new"] });
        await store.close();
        const reopened = await OpenKeyValueDatabase(key);
        try {
            const recovered = new ObsidianPersistenceAdapter(() => reopened);
            await expect(recovered.loadSnapshotEntries()).resolves.toEqual([]);
            await recovered.applySnapshotDelta({ upsert: [first], remove: [] });
            expect(await reopened.keys(entryRange())).toEqual([entryKey(3)]);
            expect(await reopened.get(entryKey(3))).toEqual(first);
        } finally {
            await reopened.close();
        }
    });

    it("keeps compound keys outside openSimpleStore and wipes incremental state on database reset", async () => {
        const { service, databaseEvents, store } = await openService();
        const adapter = new ObsidianPersistenceAdapter(() => service.incrementalStore);
        const reset = vi.fn(async () => {
            adapter.invalidate();
            await adapter.join();
        });
        service.onStoreReplacement(reset);
        const simple = service.openSimpleStore("storage");
        await simple.set("visible", true);
        await adapter.applySnapshotDelta({ upsert: [{ id: "1", event: changed("old.md") }], remove: [] });
        expect(await simple.keys(undefined, undefined)).toEqual(["visible"]);
        expect(await store.keys()).toEqual(["storage-visible", entryKey(1), metaKey]);
        await expect(databaseEvents.onDatabaseInitialisation({} as never)).resolves.toBe(true);
        expect(reset).not.toHaveBeenCalled();
        expect(service.kvDB).toBe(store);
        await expect(databaseEvents.onResetDatabase({} as never)).resolves.toBe(true);
        expect(reset).toHaveBeenCalledTimes(1);
        expect(service.kvDB).not.toBe(store);
        await expect(adapter.loadSnapshotEntries()).resolves.toBeNull();
        await expect(service.kvDB.keys()).resolves.toEqual([]);
    });
});

function createManager(service: ObsidianKeyValueDBService, process: (event: FileEventItem) => Promise<void>) {
    const dependencies = {
        setting: { currentSettings: () => ({ batchSave: false }) },
        vaultService: {},
        fileProcessing: { batched: { value: 0 }, processing: { value: 0 }, totalQueued: { value: 0 } },
        storageAccessManager: {},
        APIService: { addLog: vi.fn() },
    } as unknown as StorageEventManagerBaseDependencies;
    const manager = new StorageEventManagerObsidian({} as never, {} as never, dependencies, service);
    vi.spyOn(manager as unknown as { handleFileEvent: typeof process }, "handleFileEvent").mockImplementation(process);
    return manager;
}

describe("corrupt active Obsidian storage-event snapshots", () => {
    it.each([
        { cause: "unknown format", format: "incremental-v2", highWaterSequence: 2, id: "2", invalid: "metadata" },
        {
            cause: "negative high-water sequence",
            format: "incremental-v1",
            highWaterSequence: -1,
            id: "2",
            invalid: "metadata",
        },
        {
            cause: "fractional high-water sequence",
            format: "incremental-v1",
            highWaterSequence: 2.5,
            id: "2",
            invalid: "metadata",
        },
        {
            cause: "record past the high-water sequence",
            format: "incremental-v1",
            highWaterSequence: 1,
            id: "2",
            invalid: "record",
        },
        {
            cause: "duplicate logical record IDs",
            format: "incremental-v1",
            highWaterSequence: 2,
            id: "1",
            invalid: "record",
        },
        { cause: "empty record ID", format: "incremental-v1", highWaterSequence: 2, id: "", invalid: "record" },
    ])(
        "rejects $cause without dispatching or acknowledging stored events",
        async ({ format, highWaterSequence, id, invalid }) => {
            const { service, store } = await openService();
            const entries = [
                { key: metaKey, value: { format, highWaterSequence } },
                { key: entryKey(1), value: { id: "1", event: changed("first.md") } },
                { key: entryKey(2), value: { id, event: changed("second.md") } },
            ];
            await store.applyBatch(entries.map(({ key, value }) => ({ type: "put", key, value })));
            const before = await store.getEntries();
            const processed = vi.fn<(_event: FileEventItem) => Promise<void>>().mockResolvedValue(undefined);
            const manager = createManager(service, processed);
            const adapter = new ObsidianPersistenceAdapter(() => service.incrementalStore);
            const write = vi.spyOn(store, "applyBatch");
            const error = `Invalid incremental storage event ${invalid}`;

            try {
                await expect(adapter.loadSnapshotEntries()).rejects.toThrow(error);
                await expect(manager.restoreState()).rejects.toThrow(error);
            } finally {
                await manager.stopWatching();
            }

            expect(processed).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
            await expect(store.getEntries()).resolves.toEqual(before);
        }
    );
});

describe("Obsidian snapshot durability while the Commonlib writer has detached a batch", () => {
    it.each([false, true])(
        "isolates concurrent admissions and completion outcomes, with write failure = %s",
        async (fail) => {
            const { service, store } = await openService();
            const releaseA = promiseWithResolvers<void>();
            const releaseB = promiseWithResolvers<void>();
            const startedA = promiseWithResolvers<void>();
            const startedB = promiseWithResolvers<void>();
            const a = changed("a.md");
            const b = changed("b.md");
            const processed = vi.fn(async (event: FileEventItem) => {
                if (event === a) {
                    startedA.resolve();
                    await releaseA.promise;
                } else if (event === b) {
                    startedB.resolve();
                    await releaseB.promise;
                }
            });
            const manager = createManager(service, processed);
            await manager.restoreState();

            const writingA = promiseWithResolvers<void>();
            const writingB = promiseWithResolvers<void>();
            const commitB = promiseWithResolvers<void>();
            const committedA = vi.fn();
            let releaseCommitA = false;
            const deleteEntry = IDBObjectStore.prototype.delete;
            vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, key) {
                const request = deleteEntry.call(this, key);
                if (indexedDB.cmp(key, entryKey(1)) === 0) {
                    this.transaction.addEventListener("complete", committedA);
                    // Keep the native transaction active after its delete request succeeds.
                    const waitForRelease = () => {
                        if (!releaseCommitA) {
                            this.get(entryKey(1)).addEventListener("success", waitForRelease);
                        } else if (fail) {
                            this.transaction.abort();
                        }
                    };
                    request.addEventListener("success", () => {
                        writingA.resolve();
                        waitForRelease();
                    });
                }
                return request;
            });
            const applyBatch = store.applyBatch.bind(store);
            vi.spyOn(store, "applyBatch").mockImplementation(async (batch, check, signal) => {
                const admittingB = batch.some(
                    ({ key, type }) => type === "put" && indexedDB.cmp(key, entryKey(2)) === 0
                );
                if (admittingB) {
                    writingB.resolve();
                    await commitB.promise;
                }
                await applyBatch(batch, check, signal);
            });

            // Inject the defensive completion cases at Commonlib's writer boundary using
            // the real entry and attempt delivered there by A's completed handler.
            type Completion = { entry: { event: QueuedFileEvent }; attempt: { admissionFailure?: { error: Error } } };
            type Writer = { persistSnapshot(completion?: Completion, version?: number): Promise<void> };
            const writer = manager as unknown as Writer;
            const persist = writer.persistSnapshot.bind(manager);
            const admissionError = new Error("Admission failed");
            let isolated: Promise<PromiseSettledResult<void>[]> | undefined;
            vi.spyOn(writer, "persistSnapshot").mockImplementation((completion, version) => {
                if (completion?.entry.event === a) {
                    isolated = Promise.allSettled([
                        persist({ ...completion, attempt: { ...completion.attempt } }),
                        persist({
                            ...completion,
                            attempt: { ...completion.attempt, admissionFailure: { error: admissionError } },
                        }),
                    ]);
                }
                return persist(completion, version);
            });

            const stored = async () =>
                (await store.getEntries<StorageEventSnapshotRecord>(entryRange())).map(({ value }) => value.event);
            try {
                manager.enqueue(a);
                await startedA.promise;
                expect(await stored()).toEqual([a]);
                const flushedA = Promise.allSettled([manager.waitForIdle()]);
                releaseA.resolve();
                await writingA.promise;
                expect(manager.hasPendingFileEvent(a.args.file.path as FilePath)).toBe(true);
                expect(committedA).not.toHaveBeenCalled();

                manager.enqueue(b);
                expect(manager.hasPendingFileEvent(b.args.file.path as FilePath)).toBe(true);
                expect(processed.mock.calls).toEqual([[a]]);
                expect(committedA).not.toHaveBeenCalled();
                expect(await isolated).toEqual([
                    { status: "fulfilled", value: undefined },
                    { status: "rejected", reason: admissionError },
                ]);

                releaseCommitA = true;
                await writingB.promise;
                expect(committedA).toHaveBeenCalledTimes(fail ? 0 : 1);
                expect(await flushedA).toEqual([
                    fail
                        ? { status: "rejected", reason: expect.objectContaining({ name: "AbortError" }) }
                        : { status: "fulfilled", value: undefined },
                ]);
                expect(manager.hasPendingFileEvent(a.args.file.path as FilePath)).toBe(fail);
                expect(manager.hasPendingFileEvent(b.args.file.path as FilePath)).toBe(true);
                expect(await stored()).toEqual(fail ? [a] : []);
                expect(processed.mock.calls).toEqual([[a]]);

                commitB.resolve();
                await startedB.promise;
                expect(processed.mock.calls).toEqual([[a], [b]]);
                expect(await stored()).toEqual(fail ? [a, b] : [b]);
                releaseB.resolve();
                await vi.waitFor(() => expect(manager.hasPendingFileEvent(b.args.file.path as FilePath)).toBe(false));
                expect(await stored()).toEqual(fail ? [a] : []);
            } finally {
                releaseA.resolve();
                releaseB.resolve();
                releaseCommitA = true;
                commitB.resolve();
                await manager.stopWatching();
            }
        }
    );

    it("fences an in-flight old-store completion before reset and persists pending intent in the replacement", async () => {
        const { service, databaseEvents, store } = await openService();
        const release = promiseWithResolvers<void>();
        const submitted = promiseWithResolvers<void>();
        const processed = vi.fn(async () => {});
        const manager = createManager(service, processed);
        await manager.restoreState();
        const applyBatch = store.applyBatch.bind(store);
        vi.spyOn(store, "applyBatch").mockImplementation(async (batch, check, signal) => {
            await applyBatch(batch, check, signal);
            submitted.resolve();
            await release.promise;
        });

        const old = changed("retained.md");
        await manager.pauseDispatch();
        manager.enqueue(old);
        const oldWrite = manager._takeSnapshot().catch((error: unknown) => error);
        await submitted.promise;
        expect(await store.get(entryKey(1))).toEqual({ id: "000000000001", event: old });
        const resetting = databaseEvents.onResetDatabase({} as never);
        await vi.waitFor(() => expect(() => service.kvDB).toThrow("not initialized"));
        release.resolve();
        expect(await oldWrite).toBeInstanceOf(StorageEventPersistenceInterrupted);
        await expect(resetting).resolves.toBe(true);
        expect(service.kvDB).not.toBe(store);
        expect(await service.kvDB.get(metaKey)).toBeUndefined();
        expect(manager.hasPendingFileEvent(old.args.file.path as FilePath)).toBe(true);

        const replacement = service.kvDB;
        if (!(replacement instanceof IDBKeyValueDatabase)) {
            throw new Error("Expected an IndexedDB replacement store");
        }
        const getEntries = replacement.getEntries.bind(replacement);
        const loadStarted = promiseWithResolvers<void>();
        const releaseLoad = promiseWithResolvers<void>();
        vi.spyOn(replacement, "getEntries").mockImplementationOnce(async (...args) => {
            loadStarted.resolve();
            await releaseLoad.promise;
            return getEntries(...args);
        });

        const replacementWrite = manager._takeSnapshot();
        await loadStarted.promise;
        try {
            expect(await replacement.get(entryKey(1))).toBeUndefined();
            expect(await replacement.get("initialized")).toBeUndefined();
        } finally {
            releaseLoad.resolve();
        }
        await expect(replacementWrite).resolves.toBeUndefined();
        expect(await replacement.get(entryKey(1))).toEqual({ id: "000000000001", event: old });
        await manager.stopWatching();
        expect(processed).not.toHaveBeenCalled();
    });

    it("migrates and loads a legacy internal-file event without stat even when type is CHANGED", async () => {
        const { store } = await openService();
        const internalChanged: FileEventItem = {
            type: "CHANGED",
            key: "internal-changed",
            args: {
                file: {
                    path: ".obsidian/plugins/sample/data.json" as FilePath,
                    name: "data.json",
                    isFolder: false,
                    isInternal: true,
                    stat: undefined,
                },
            },
        };
        await store.set(legacyKey, [internalChanged]);
        const adapter = new ObsidianPersistenceAdapter(() => store);
        const records = await adapter.loadSnapshotEntries();
        expect(records).toEqual([{ id: "000000000001", event: internalChanged }]);
    });
});
