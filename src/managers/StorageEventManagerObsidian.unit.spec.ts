import "fake-indexeddb/auto";
import { forceCloseDatabase } from "fake-indexeddb";
import { deleteDB, openDB, unwrap } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promiseWithResolvers } from "octagonal-wheels/promises";
import { KeyValueDatabaseOwner, type IDBKeyValueDatabase } from "@/common/KeyValueDBv2";
import type { FileEventItem, FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    StorageEventManagerBase,
    type StorageEventManagerBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import { StorageEventManagerObsidian } from "./StorageEventManagerObsidian";
vi.mock("@/deps", () => ({ TFile: class {}, TFolder: class {} }));

afterEach(() => vi.restoreAllMocks());
describe("Obsidian internal file event admission", () => {
    it("wires isTargetInternalFile to vaultService.isTargetFile with internalFileEvent: true", async () => {
        const isTargetFile = vi.fn(async () => true);
        const dependencies = {
            vaultService: { isTargetFile },
            fileProcessing: {},
            setting: { currentSettings: () => ({}) },
            storageAccess: {},
            appLifecycle: {},
            context: {},
        } as unknown as StorageEventManagerBaseDependencies;
        const manager = new StorageEventManagerObsidian({} as any, {} as any, dependencies, {
            onStoreReplacement: vi.fn(),
        } as never);
        const internalChecker = (manager as any).admission.isTargetInternal as (path: FilePath) => Promise<boolean>;

        await expect(internalChecker(".obsidian/snippets/a.css" as FilePath)).resolves.toBe(true);
        expect(isTargetFile).toHaveBeenCalledWith(".obsidian/snippets/a.css", { internalFileEvent: true });
    });

    it("admits config-directory files accepted by isTargetFileInExtra and rejects siblings and folders", async () => {
        const appendQueue = vi.fn();
        const isTargetFileInExtra = vi.fn(async (path: string) => path === ".obsidian/snippets/a.css");
        const receiver = {
            settings: {
                syncInternalFiles: false,
                usePluginSync: true,
                watchInternalFileChanges: true,
                handleFilenameCaseSensitive: true,
            },
            core: { services: { API: { getSystemConfigDir: () => ".obsidian" } } },
            vaultService: { isTargetFileInExtra, isStorageInsensitive: () => false },
            adapter: { converter: { toInternalFileInfo: (path: FilePath) => ({ path, isInternal: true }) } },
            appendQueue,
        };
        const watchRaw = (StorageEventManagerObsidian.prototype as any)._watchVaultRawEvents;

        await watchRaw.call(receiver, ".obsidian-other/snippets/a.css" as FilePath);
        await watchRaw.call(receiver, ".obsidian/snippets/" as FilePath);
        await watchRaw.call(receiver, ".obsidian/snippets/ignored.css" as FilePath);
        await watchRaw.call(receiver, ".obsidian/snippets/a.css" as FilePath);

        expect(isTargetFileInExtra).toHaveBeenCalledTimes(2);
        expect(appendQueue).toHaveBeenCalledTimes(1);
        expect(appendQueue).toHaveBeenCalledWith(
            [
                {
                    type: "INTERNAL",
                    file: { path: ".obsidian/snippets/a.css", isInternal: true },
                    skipBatchWait: true,
                },
            ],
            null
        );
    });
});

describe("Obsidian file-processing failure boundary", () => {
    it("requests an owned database check without awaiting recovery which may drain this file event", async () => {
        const cause = new Error("file processing failed");
        const selected = {};
        const onLocalDatabaseError = vi.fn(() => new Promise<boolean>(() => {}));
        vi.spyOn(StorageEventManagerBase.prototype as any, "handleFileEvent").mockRejectedValue(cause);
        const receiver = { core: { services: { database: { localDatabaseDirect: selected, onLocalDatabaseError } } } };
        const handle = (StorageEventManagerObsidian.prototype as any).handleFileEvent;
        await expect(handle.call(receiver, {})).rejects.toBe(cause);
        expect(onLocalDatabaseError).toHaveBeenCalledWith(selected, cause);
    });
});

function event(path: string): FileEventItem {
    return {
        key: path,
        type: "CHANGED",
        args: { file: { path: path as FilePath, name: path, stat: { size: 1, ctime: 1, mtime: 1, type: "file" } } },
    };
}

function createManager(
    store: () => IDBKeyValueDatabase,
    handle: (event: FileEventItem) => Promise<void>,
    batchSave = false
) {
    const dependencies = {
        setting: {
            currentSettings: () => ({ batchSave, batchSaveMinimumDelay: 60, batchSaveMaximumDelay: 60 }),
        },
        fileProcessing: { batched: { value: 0 }, processing: { value: 0 }, totalQueued: { value: 0 } },
        APIService: { addLog: vi.fn() },
    } as unknown as StorageEventManagerBaseDependencies;
    const manager = new StorageEventManagerObsidian({} as never, {} as never, dependencies, {
        get incrementalStore() {
            return store();
        },
        onStoreReplacement: vi.fn(),
    });
    vi.spyOn(manager as unknown as { handleFileEvent: typeof handle }, "handleFileEvent").mockImplementation(handle);
    return manager;
}

describe("Obsidian storage-event hot re-enable", () => {
    it.each(["staging migration", "active handler", "acknowledgement", "batch wait"] as const)(
        "joins the retiring owner during %s and recovers exactly the unstarted intent",
        async (phase) => {
            const key = `storage-event-lifecycle-${phase}`;
            const retiring = new KeyValueDatabaseOwner(async () => {});
            const owner = new KeyValueDatabaseOwner(async () => {});
            const oldStore = await retiring.open(key);
            let newStore: IDBKeyValueDatabase | undefined;
            const existing = event("done.md");
            const pending = event("unstarted.md");
            const reached = promiseWithResolvers<void>();
            const release = promiseWithResolvers<void>();
            const oldProcess = vi.fn(async (item: FileEventItem) => {
                if (phase === "active handler" && item === existing) {
                    reached.resolve();
                    await release.promise;
                }
            });
            const old = createManager(() => oldStore, oldProcess, phase === "batch wait");
            const closeOld = vi.spyOn(await oldStore.DB, "close");
            const apply = oldStore.applyBatch.bind(oldStore);
            const writes = vi.spyOn(oldStore, "applyBatch");
            let firstRestore: Promise<void> | undefined;
            let firstFlush: Promise<void> | undefined;
            let nextOpen: Promise<IDBKeyValueDatabase> | undefined;

            try {
                if (phase === "staging migration") {
                    await oldStore.set("storage-event-manager-snapshot", [pending]);
                    writes.mockImplementationOnce(async (batch, check, signal) => {
                        await apply(batch, check, signal);
                        reached.resolve();
                        await release.promise;
                    });
                    firstRestore = old.restoreState();
                    await reached.promise;
                } else {
                    await old.restoreState();
                    if (phase === "active handler" || phase === "acknowledgement") {
                        if (phase === "acknowledgement") {
                            writes.mockImplementation(async (batch, check, signal) => {
                                if (batch.some(({ type }) => type === "delete")) {
                                    reached.resolve();
                                    await release.promise;
                                }
                                await apply(batch, check, signal);
                            });
                        }
                        old.enqueue(existing);
                        await reached.promise;
                        firstFlush = old.waitForIdle();
                        void firstFlush.catch(() => undefined);
                        if (phase === "acknowledgement") {
                            writes.mockImplementation((batch, check, signal) => apply(batch, check, signal));
                        }
                        // Pause takes effect synchronously and joins the already-started handler.
                        void old.pauseDispatch();
                    }
                    old.enqueue(pending);
                    if (phase === "batch wait") {
                        await vi.waitFor(() => expect(old.isWaiting(pending.args.file.path as FilePath)).toBe(true));
                    }
                }

                old.beginStopWatching();
                const retired = retiring.retire(() => old.stopWatching());
                nextOpen = owner.open(key);
                const recovered = vi.fn(async () => {
                    throw new Error("Leave replayed intent pending for inspection");
                });
                const next = createManager(() => {
                    if (!newStore) throw new Error("Successor opened before handoff");
                    return newStore;
                }, recovered);
                const started = vi.fn();
                const restart = nextOpen.then(async (store) => {
                    newStore = store;
                    started();
                    await next.restoreState();
                });

                if (phase !== "batch wait") {
                    await Promise.resolve();
                    expect(started).not.toHaveBeenCalled();
                    expect(closeOld).not.toHaveBeenCalled();
                }
                expect(old.isStopping()).toBe(true);
                release.resolve();
                await retired;
                await firstRestore;
                await firstFlush;
                const oldWriteCount = writes.mock.calls.length;
                await restart;

                expect(oldProcess.mock.calls.map(([item]) => item.key)).toEqual(
                    phase === "active handler" || phase === "acknowledgement" ? [existing.key] : []
                );
                expect(recovered).toHaveBeenCalledTimes(1);
                expect(recovered).toHaveBeenCalledWith({
                    ...pending,
                    restoredFromPreviousRuntime: true,
                    skipBatchWait: true,
                });
                expect(next.hasPendingFileEvent(pending.args.file.path as FilePath)).toBe(true);
                const stored = await newStore?.getEntries<{ event: FileEventItem }>(
                    IDBKeyRange.bound(["storage-event-manager-entry", 1], ["storage-event-manager-entry", []])
                );
                expect(stored?.map(({ value }) => value.event)).toEqual([pending]);
                await expect(oldStore.set("stale", true)).rejects.toThrow("closed");
                expect(writes).toHaveBeenCalledTimes(oldWriteCount + 1); // The explicit rejected probe above.
                expect(closeOld).toHaveBeenCalledTimes(1);
                await next.stopWatching();
            } finally {
                release.resolve();
                await retiring.retire(() => old.stopWatching());
                const store = await (nextOpen ?? owner.open(key));
                await store.destroy();
            }
        }
    );
});

describe("Obsidian storage-event store reconnection", () => {
    it.each(["terminated", "version upgrade", "terminated with external deletion"] as const)(
        "persists pending events and dispatches each once after %s",
        async (cause) => {
            const key = `storage-event-reconnect-${cause.replace(/\s+/g, "-")}`;
            let onReplacement: (() => Promise<void>) | undefined;
            const owner = new KeyValueDatabaseOwner(async () => {
                await onReplacement?.();
            });
            const store = await owner.open(key);
            const processed: string[] = [];
            const dependencies = {
                setting: { currentSettings: () => ({ batchSave: false }) },
                fileProcessing: { batched: { value: 0 }, processing: { value: 0 }, totalQueued: { value: 0 } },
                APIService: { addLog: vi.fn() },
            } as unknown as StorageEventManagerBaseDependencies;
            const manager = new StorageEventManagerObsidian({} as never, {} as never, dependencies, {
                get incrementalStore() {
                    return store;
                },
                onStoreReplacement(callback) {
                    onReplacement = callback;
                },
            });
            const resetPersistenceState = vi.spyOn(manager, "resetPersistenceState");
            vi.spyOn(
                manager as unknown as { handleFileEvent: (item: FileEventItem) => Promise<void> },
                "handleFileEvent"
            ).mockImplementation(async (item) => {
                processed.push(item.key);
            });

            try {
                await manager.restoreState();
                await manager.pauseDispatch();

                const one = event("one.md");
                manager.enqueue(one);
                await manager._takeSnapshot();
                const initialEpoch = store.connectionEpoch;

                if (cause === "version upgrade") {
                    const upgraded = await openDB(key, 2, {
                        upgrade: (db) => {
                            if (!db.objectStoreNames.contains(key)) db.createObjectStore(key);
                        },
                    });
                    upgraded.close();
                } else {
                    const connection = await store.DB;
                    forceCloseDatabase(unwrap(connection) as unknown as Parameters<typeof forceCloseDatabase>[0]);
                }

                await vi.waitFor(() => expect(store.connectionEpoch).toBeGreaterThan(initialEpoch));
                const storeDeleted = cause === "terminated with external deletion";
                if (storeDeleted) {
                    await deleteDB(key);
                }
                expect(resetPersistenceState).not.toHaveBeenCalled();

                const two = event("two.md");
                manager.enqueue(two);
                const snapshot = manager._takeSnapshot();
                if (storeDeleted) {
                    await expect(snapshot).rejects.toThrow("Storage event store was replaced");
                    await manager._takeSnapshot();
                } else {
                    await snapshot;
                }
                expect(resetPersistenceState).toHaveBeenCalledTimes(storeDeleted ? 1 : 0);

                const entries = await store.getEntries<{ id: string; event: FileEventItem }>(
                    IDBKeyRange.bound(["storage-event-manager-entry", 1], ["storage-event-manager-entry", []])
                );
                expect(entries.map(({ value }) => ({ id: value.id, key: value.event.key }))).toEqual([
                    { id: "000000000001", key: "one.md" },
                    { id: "000000000002", key: "two.md" },
                ]);

                manager.resumeDispatch();
                await manager.waitForIdle();
                expect(processed).toEqual(["one.md", "two.md"]);
                const remaining = await store.getEntries(
                    IDBKeyRange.bound(["storage-event-manager-entry", 1], ["storage-event-manager-entry", []])
                );
                expect(remaining).toEqual([]);
            } finally {
                await manager.stopWatching();
                await store.destroy();
            }
        }
    );

    it("fences a stale acknowledgement when a recreated store reuses the same ID and physical sequence after termination", async () => {
        const key = "storage-event-reconnect-colliding-replacement";
        let onReplacement: (() => Promise<void>) | undefined;
        const owner = new KeyValueDatabaseOwner(async () => {
            await onReplacement?.();
        });
        const store = await owner.open(key);
        const oldStarted = promiseWithResolvers<void>();
        const releaseOld = promiseWithResolvers<void>();
        const processed: string[] = [];
        const dependencies = {
            setting: { currentSettings: () => ({ batchSave: false }) },
            fileProcessing: { batched: { value: 0 }, processing: { value: 0 }, totalQueued: { value: 0 } },
            APIService: { addLog: vi.fn() },
        } as unknown as StorageEventManagerBaseDependencies;
        const oldManager = new StorageEventManagerObsidian({} as never, {} as never, dependencies, {
            get incrementalStore() {
                return store;
            },
            onStoreReplacement(callback) {
                onReplacement = callback;
            },
        });
        vi.spyOn(
            oldManager as unknown as { handleFileEvent: (item: FileEventItem) => Promise<void> },
            "handleFileEvent"
        ).mockImplementation(async (item) => {
            processed.push(item.key);
            if (item.key === "old.md") {
                oldStarted.resolve();
                await releaseOld.promise;
            }
        });

        try {
            await oldManager.restoreState();
            const oldItem = event("old.md");
            oldManager.enqueue(oldItem);
            await oldStarted.promise;

            const connection = await store.DB;
            const initialEpoch = store.connectionEpoch;
            forceCloseDatabase(unwrap(connection) as unknown as Parameters<typeof forceCloseDatabase>[0]);
            await vi.waitFor(() => expect(store.connectionEpoch).toBeGreaterThan(initialEpoch));
            await deleteDB(key);

            const replacementOwner = new KeyValueDatabaseOwner(async () => {});
            const replacementStore = await replacementOwner.open(key);
            const replacementManager = createManager(() => replacementStore, async () => {});
            await replacementManager.restoreState();
            await replacementManager.pauseDispatch();
            const replacementItem = event("replacement.md");
            replacementManager.enqueue(replacementItem);
            await replacementManager._takeSnapshot();
            await replacementOwner.retire(() => replacementManager.stopWatching());

            const before = await store.getEntries<{ id: string; event: FileEventItem }>(
                IDBKeyRange.bound(["storage-event-manager-entry", 1], ["storage-event-manager-entry", []])
            );
            expect(before.map(({ value }) => ({ id: value.id, key: value.event.key }))).toEqual([
                { id: "000000000001", key: "replacement.md" },
            ]);

            const idle = oldManager.waitForIdle();
            releaseOld.resolve();
            await expect(idle).rejects.toThrow("Storage event store was replaced");

            const after = await store.getEntries<{ id: string; event: FileEventItem }>(
                IDBKeyRange.bound(["storage-event-manager-entry", 1], ["storage-event-manager-entry", []])
            );
            expect(after.map(({ value }) => ({ id: value.id, key: value.event.key }))).toEqual([
                { id: "000000000001", key: "replacement.md" },
            ]);
            expect(processed).toEqual(["old.md"]);
        } finally {
            releaseOld.resolve();
            await oldManager.stopWatching().catch(() => undefined);
            await store.destroy().catch(() => undefined);
        }
    });

    it.each(["terminated", "version upgrade"] as const)(
        "leaves initial restoration retryable when %s interrupts legacy migration before cutover",
        async (cause) => {
            const key = `storage-event-reconnect-migration-${cause.replace(/\s+/g, "-")}`;
            const owner = new KeyValueDatabaseOwner(async () => {});
            const store = await owner.open(key);
            const saved = event("saved.md");
            const processed: string[] = [];
            const manager = createManager(
                () => store,
                async (item) => {
                    processed.push(item.key);
                }
            );
            const apply = store.applyBatch.bind(store);
            const writes = vi.spyOn(store, "applyBatch");
            let interrupted = false;

            try {
                await store.set("storage-event-manager-snapshot", [saved]);
                writes.mockImplementation(async (batch, check, signal) => {
                    const isStaging = !interrupted && batch.some(({ type }) => type === "put") && !batch.some(({ type }) => type === "delete");
                    await apply(batch, check, signal);
                    if (!isStaging) return;
                    interrupted = true;
                    const initialEpoch = store.connectionEpoch;
                    if (cause === "version upgrade") {
                        const upgraded = await openDB(key, 2, {
                            upgrade: (db) => {
                                if (!db.objectStoreNames.contains(key)) db.createObjectStore(key);
                            },
                        });
                        upgraded.close();
                    } else {
                        const connection = await store.DB;
                        forceCloseDatabase(unwrap(connection) as unknown as Parameters<typeof forceCloseDatabase>[0]);
                    }
                    await vi.waitFor(() => expect(store.connectionEpoch).toBeGreaterThan(initialEpoch));
                });

                await expect(manager.restoreState()).rejects.toThrow("Storage event persistence was interrupted");
                expect(processed).toEqual([]);
                expect(await store.get("storage-event-manager-snapshot")).toEqual([saved]);

                await manager.restoreState();
                expect(processed).toEqual(["saved.md"]);
                expect(await store.get("storage-event-manager-snapshot")).toBeUndefined();

                await manager.pauseDispatch();
                const next = event("next.md");
                manager.enqueue(next);
                await manager._takeSnapshot();
                const entries = await store.getEntries<{ id: string; event: FileEventItem }>(
                    IDBKeyRange.bound(["storage-event-manager-entry", 1], ["storage-event-manager-entry", []])
                );
                expect(entries.map(({ value }) => value.event.key)).toEqual(["next.md"]);
                manager.resumeDispatch();
                await manager.waitForIdle();
                expect(processed).toEqual(["saved.md", "next.md"]);
            } finally {
                await manager.stopWatching().catch(() => undefined);
                await store.destroy().catch(() => undefined);
            }
        }
    );
});
