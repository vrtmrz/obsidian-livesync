import { TFile, TFolder } from "@/deps";
import type { FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IStorageEventManagerAdapter } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type {
    IStorageEventTypeGuardAdapter,
    IStorageEventWatchAdapter,
    IStorageEventStatusAdapter,
    IStorageEventConverterAdapter,
    IStorageEventWatchHandlers,
} from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import type { QueuedFileEvent } from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import type {
    IStorageEventIncrementalPersistenceAdapter,
    StorageEventSnapshotDelta,
    StorageEventSnapshotRecord,
} from "@vrtmrz/livesync-commonlib/storage";
import type { IncrementalKeyValueStore, KeyValueBatchOperation } from "@/common/KeyValueDBv2";
import { readStorageEvent, readStorageEvents } from "@/common/storageEventValidation";
import { delay } from "octagonal-wheels/promises";
import type ObsidianLiveSyncPlugin from "@/main";
import type { FileProcessingService } from "@vrtmrz/livesync-commonlib/compat/services/base/FileProcessingService";
import { InternalFileToUXFileInfoStub, TFileToUXFileInfoStub } from "@/modules/coreObsidian/storage/utilObsidian";

/**
 * Obsidian-specific type guard adapter
 */
class ObsidianTypeGuardAdapter implements IStorageEventTypeGuardAdapter<TFile, TFolder> {
    isFile(file: unknown): file is TFile {
        if (file instanceof TFile) {
            return true;
        }
        if (file && typeof file === "object" && "isFolder" in file) {
            return !file.isFolder;
        }
        return false;
    }

    isFolder(item: unknown): item is TFolder {
        if (item instanceof TFolder) {
            return true;
        }
        if (item && typeof item === "object" && "isFolder" in item) {
            return !!item.isFolder;
        }
        return false;
    }
}

const legacyKey = "storage-event-manager-snapshot";
const entryPrefix = "storage-event-manager-entry";
const metaKey = ["storage-event-manager-meta", "state"];

function entryKey(sequence: number): IDBValidKey {
    return [entryPrefix, sequence];
}

function entryRange(afterKey?: IDBValidKey): IDBKeyRange {
    // The next string after the prefix bounds all its compound keys, regardless of suffix type.
    return IDBKeyRange.bound(afterKey ?? [entryPrefix], [entryPrefix + "\0"], afterKey !== undefined, true);
}

function physicalSequence(key: IDBValidKey): number | undefined {
    const sequence = Array.isArray(key) && key.length === 2 ? key[1] : undefined;
    return typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0 ? sequence : undefined;
}

type SnapshotMetadata = {
    format: "incremental-v1";
    highWaterSequence: number;
    storeId?: string;
};

let nextFallbackStoreId = 0;

function createStoreId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextFallbackStoreId}`;
}

function metadataPut(highWaterSequence: number, storeId: string): KeyValueBatchOperation {
    const value: SnapshotMetadata = { format: "incremental-v1", highWaterSequence, storeId };
    return { type: "put", key: metaKey, value };
}

function sanitiseLegacyEvent(event: QueuedFileEvent): QueuedFileEvent {
    if (event.type === "SENTINEL_FLUSH") return { type: event.type };
    const intent = { ...event, args: { ...event.args } };
    delete intent.restoredFromPreviousRuntime;
    delete intent.skipBatchWait;
    delete intent.args.cache;
    return intent;
}

interface SnapshotIndex {
    store: IncrementalKeyValueStore;
    connectionEpoch: number;
    idToPhysicalSeq: Map<string, number>;
    highWaterSequence: number;
    storeId?: string;
}

interface MigrationOptions {
    migrationChunkSize?: number;
    onBeforeStagingChunk?: (offset: number) => void | Promise<void>;
    onBeforeCutover?: () => void | Promise<void>;
}

export class StorageEventPersistenceInterrupted extends Error {}

export class ObsidianPersistenceAdapter implements IStorageEventIncrementalPersistenceAdapter {
    private generation = 0;
    private retired = false;
    private restoreAborted = false;
    private restoreAbort = new AbortController();
    private tail: Promise<void> = Promise.resolve();
    private readonly migrationChunkSize: number;
    private index?: SnapshotIndex;
    private acquiredEmpty = false;

    constructor(
        private readonly getStore: () => IncrementalKeyValueStore,
        private readonly migration: MigrationOptions = {},
        private readonly onStoreReplaced?: () => void
    ) {
        this.migrationChunkSize = migration.migrationChunkSize ?? 200;
        if (!Number.isSafeInteger(this.migrationChunkSize) || this.migrationChunkSize < 1) {
            throw new RangeError("Invalid storage event migration chunk size");
        }
    }

    abortRestore(): void {
        this.restoreAborted = true;
        this.restoreAbort.abort(new StorageEventPersistenceInterrupted("Storage event restoration stopped"));
    }

    invalidate(): void {
        ++this.generation;
        this.index = undefined;
        this.acquiredEmpty = false;
        this.restoreAbort.abort(new StorageEventPersistenceInterrupted("Storage event store changed"));
        if (!this.restoreAborted) this.restoreAbort = new AbortController();
    }

    join(): Promise<void> {
        return this.tail;
    }

    retire(): Promise<void> {
        this.retired = true;
        return this.join();
    }

    private async withStore<T>(
        operation: (store: IncrementalKeyValueStore, check: () => void) => Promise<T>,
        restoring = false
    ): Promise<T> {
        const store = this.getStore();
        const generation = this.generation;
        const connectionEpoch = store.connectionEpoch;
        const check = () => {
            if (
                this.retired ||
                generation !== this.generation ||
                (restoring && this.restoreAborted) ||
                store.connectionEpoch !== connectionEpoch ||
                store !== this.getStore()
            ) {
                throw new StorageEventPersistenceInterrupted("Storage event persistence was interrupted");
            }
        };

        const pending = this.tail.then(async () => {
            check();
            return await operation(store, check);
        });
        this.tail = pending.then(
            (): void => undefined,
            (): void => undefined
        );
        return await pending;
    }

    saveSnapshot(snapshot: QueuedFileEvent[]): Promise<void> {
        return this.withStore(async (store, check) => {
            if ((await store.keys(metaKey, 1)).length || (await store.keys(entryRange(), 1)).length) {
                throw new Error("Storage event snapshot is already staged or incremental");
            }
            await store.applyBatch([{ type: "put", key: legacyKey, value: snapshot }], check);
            check();
        });
    }

    loadSnapshot(): Promise<QueuedFileEvent[] | null> {
        return this.withStore(async (store, check) => {
            const legacy = await this.readLegacy(store);
            check();
            return legacy;
        });
    }

    loadSnapshotEntries(): Promise<readonly StorageEventSnapshotRecord[] | null> {
        const signal = this.restoreAbort.signal;
        return this.withStore(async (store, check) => {
            const [legacy, meta] = await Promise.all([this.readLegacy(store), this.readMetadata(store)]);
            check();
            if (meta === null && legacy !== null) return await this.migrate(store, legacy, check, signal);

            const active = await this.loadActive(store, meta, check);
            if (active && legacy !== null) {
                await this.appendLegacy(store, active, legacy, check, signal);
            }
            this.acquiredEmpty = active === null;
            this.index = active?.index;
            return active?.records ?? null;
        }, true);
    }

    private async readLegacy(store: IncrementalKeyValueStore): Promise<QueuedFileEvent[] | null> {
        const [legacy] = await store.getEntries<unknown>(legacyKey);
        if (!legacy) return null;
        const entries = Array.isArray(legacy.value) ? readStorageEvents(legacy.value) : null;
        if (!entries) {
            throw new Error("Invalid legacy storage event snapshot");
        }
        return entries;
    }

    private async readMetadata(store: IncrementalKeyValueStore): Promise<SnapshotMetadata | null> {
        const [meta] = await store.getEntries<Partial<SnapshotMetadata> | null>(metaKey);
        if (!meta) return null;
        const highWaterSequence = meta.value?.highWaterSequence;
        const storeId = meta.value?.storeId;
        if (
            meta.value?.format !== "incremental-v1" ||
            typeof highWaterSequence !== "number" ||
            !Number.isSafeInteger(highWaterSequence) ||
            highWaterSequence < 0 ||
            (storeId !== undefined && (typeof storeId !== "string" || !storeId))
        ) {
            throw new Error("Invalid incremental storage event metadata");
        }
        return storeId !== undefined
            ? { format: meta.value.format, highWaterSequence, storeId }
            : { format: meta.value.format, highWaterSequence };
    }

    private async loadActive(
        store: IncrementalKeyValueStore,
        meta: SnapshotMetadata | null,
        check: () => void
    ): Promise<{ records: StorageEventSnapshotRecord[]; index: SnapshotIndex } | null> {
        if (!meta) {
            const keys = await store.keys(entryRange(), 1);
            check();
            if (keys.length > 0) throw new Error("Orphaned incremental storage event records");
            return null;
        }
        const { highWaterSequence, storeId } = meta;
        const entries = await store.getEntries<StorageEventSnapshotRecord>(entryRange());
        check();
        const idToPhysicalSeq = new Map<string, number>();
        const records = entries.map(({ key, value }) => {
            const sequence = physicalSequence(key);
            const event = readStorageEvent(value?.event);
            if (
                sequence === undefined ||
                sequence > highWaterSequence ||
                typeof value?.id !== "string" ||
                !value.id ||
                !event ||
                idToPhysicalSeq.has(value.id)
            ) {
                throw new Error("Invalid incremental storage event record");
            }
            idToPhysicalSeq.set(value.id, sequence);
            return { id: value.id, event };
        });
        return {
            records,
            index: { store, connectionEpoch: store.connectionEpoch, idToPhysicalSeq, highWaterSequence, storeId },
        };
    }

    private async appendLegacy(
        store: IncrementalKeyValueStore,
        { records, index }: { records: StorageEventSnapshotRecord[]; index: SnapshotIndex },
        legacy: QueuedFileEvent[],
        check: () => void,
        signal: AbortSignal
    ): Promise<void> {
        const { idToPhysicalSeq } = index;
        const operations: KeyValueBatchOperation[] = [];
        for (const event of legacy) {
            const sequence = ++index.highWaterSequence;
            if (!Number.isSafeInteger(sequence)) throw new RangeError("Storage event sequence is exhausted");
            let id = String(sequence).padStart(12, "0");
            while (idToPhysicalSeq.has(id)) id = "legacy-" + id;
            const record = { id, event: sanitiseLegacyEvent(event) };
            records.push(record);
            idToPhysicalSeq.set(id, sequence);
            operations.push({ type: "put", key: entryKey(sequence), value: record });
        }
        if (operations.length > 0) {
            index.storeId ??= createStoreId();
            operations.push(metadataPut(index.highWaterSequence, index.storeId));
        }
        operations.push({ type: "delete", key: legacyKey });
        await store.applyBatch(operations, check, signal);
        check();
    }

    private async migrate(
        store: IncrementalKeyValueStore,
        legacy: QueuedFileEvent[],
        check: () => void,
        signal: AbortSignal
    ): Promise<StorageEventSnapshotRecord[]> {
        const records: StorageEventSnapshotRecord[] = [];
        const idToPhysicalSeq = new Map<string, number>();
        for (let offset = 0; offset < legacy.length; offset += this.migrationChunkSize) {
            check();
            await this.migration.onBeforeStagingChunk?.(offset);
            check();
            const operations = legacy.slice(offset, offset + this.migrationChunkSize).map((event, index) => {
                const sequence = offset + index + 1;
                const id = String(sequence).padStart(12, "0");
                const record = { id, event: sanitiseLegacyEvent(event) };
                records.push(record);
                idToPhysicalSeq.set(id, sequence);
                return { type: "put", key: entryKey(sequence), value: record } satisfies KeyValueBatchOperation;
            });
            await store.applyBatch(operations, check, signal);
            await delay(0);
        }
        let afterKey: IDBValidKey | undefined;
        for (;;) {
            check();
            const keys = await store.keys(entryRange(afterKey), this.migrationChunkSize);
            if (!keys.length) break;
            const strayKeys = keys.filter((key) => {
                const sequence = physicalSequence(key);
                return sequence === undefined || sequence > legacy.length;
            });
            if (strayKeys.length > 0) {
                await store.applyBatch(
                    strayKeys.map((key) => ({ type: "delete", key })),
                    check,
                    signal
                );
                await delay(0);
            }
            if (keys.length < this.migrationChunkSize) break;
            afterKey = keys[keys.length - 1];
        }
        check();
        await this.migration.onBeforeCutover?.();
        const storeId = createStoreId();
        await store.applyBatch([metadataPut(legacy.length, storeId), { type: "delete", key: legacyKey }], check, signal);
        check();
        this.acquiredEmpty = false;
        this.index = {
            store,
            connectionEpoch: store.connectionEpoch,
            idToPhysicalSeq,
            highWaterSequence: legacy.length,
            storeId,
        };
        return records;
    }

    private async loadIndexForWrite(store: IncrementalKeyValueStore, check: () => void): Promise<SnapshotIndex> {
        if (this.index?.store === store && this.index.connectionEpoch === store.connectionEpoch) return this.index;
        if ((await store.keys(legacyKey, 1)).length) {
            throw new Error("Legacy storage events must be migrated before writing deltas");
        }
        check();
        const meta = await this.readMetadata(store);
        check();
        const active = await this.loadActive(store, meta, check);
        if (this.onStoreReplaced) {
            if (this.index?.store === store && this.index.connectionEpoch !== store.connectionEpoch) {
                const previous = this.index;
                const survived =
                    active !== null &&
                    previous.storeId !== undefined &&
                    active.index.storeId === previous.storeId &&
                    active.index.highWaterSequence >= previous.highWaterSequence &&
                    [...previous.idToPhysicalSeq].every(
                        ([id, seq]) => active.index.idToPhysicalSeq.get(id) === seq
                    );
                if (!survived) {
                    this.onStoreReplaced();
                    throw new StorageEventPersistenceInterrupted("Storage event store was replaced");
                }
            } else if (this.acquiredEmpty && active !== null) {
                this.onStoreReplaced();
                throw new StorageEventPersistenceInterrupted("Storage event store was replaced");
            }
        }
        return (
            active?.index ?? {
                store,
                connectionEpoch: store.connectionEpoch,
                idToPhysicalSeq: new Map(),
                highWaterSequence: 0,
            }
        );
    }

    async applySnapshotDelta({ upsert, remove }: StorageEventSnapshotDelta): Promise<void> {
        const removedIds = new Set(remove);
        if (upsert.some(({ id }) => removedIds.has(id))) {
            throw new Error("Storage event delta both upserts and removes the same ID");
        }
        await this.withStore(async (store, check) => {
            const index = await this.loadIndexForWrite(store, check);
            const { idToPhysicalSeq } = index;
            const allocated = new Map<string, number>();
            let highWaterSequence = index.highWaterSequence;
            const storeId = index.storeId ?? createStoreId();
            const operations: KeyValueBatchOperation[] = [];
            for (const record of upsert) {
                let sequence = idToPhysicalSeq.get(record.id) ?? allocated.get(record.id);
                if (sequence === undefined) {
                    sequence = ++highWaterSequence;
                    if (!Number.isSafeInteger(sequence)) throw new RangeError("Storage event sequence is exhausted");
                    allocated.set(record.id, sequence);
                }
                operations.push({
                    type: "put",
                    key: entryKey(sequence),
                    value: { id: record.id, event: record.event },
                });
            }
            for (const id of removedIds) {
                const sequence = idToPhysicalSeq.get(id);
                if (sequence !== undefined) operations.push({ type: "delete", key: entryKey(sequence) });
            }
            operations.push(metadataPut(highWaterSequence, storeId));
            await store.applyBatch(operations, check);
            check();

            for (const id of removedIds) idToPhysicalSeq.delete(id);
            for (const [id, sequence] of allocated) idToPhysicalSeq.set(id, sequence);
            this.acquiredEmpty = false;
            this.index = { ...index, highWaterSequence, storeId };
        });
    }
}

/**
 * Obsidian-specific status adapter
 */
class ObsidianStatusAdapter implements IStorageEventStatusAdapter {
    constructor(private fileProcessing: FileProcessingService) {}

    updateStatus(status: { batched: number; processing: number; totalQueued: number }): void {
        this.fileProcessing.batched.value = status.batched;
        this.fileProcessing.processing.value = status.processing;
        this.fileProcessing.totalQueued.value = status.totalQueued;
    }
}

/**
 * Obsidian-specific converter adapter
 */
class ObsidianConverterAdapter implements IStorageEventConverterAdapter<TFile> {
    toFileInfo(file: TFile, deleted?: boolean): UXFileInfoStub {
        return TFileToUXFileInfoStub(file, deleted);
    }

    toInternalFileInfo(path: FilePath): UXInternalFileInfoStub {
        return InternalFileToUXFileInfoStub(path);
    }
}

/**
 * Obsidian-specific watch adapter
 */
class ObsidianWatchAdapter implements IStorageEventWatchAdapter {
    constructor(private plugin: ObsidianLiveSyncPlugin) {}

    beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        const plugin = this.plugin;

        const boundHandlers = {
            onCreate: handlers.onCreate.bind(handlers),
            onChange: handlers.onChange.bind(handlers),
            onDelete: handlers.onDelete.bind(handlers),
            onRename: handlers.onRename.bind(handlers),
            onRaw: handlers.onRaw.bind(handlers),
            onEditorChange: handlers.onEditorChange?.bind(handlers),
        };

        plugin.registerEvent(plugin.app.vault.on("create", boundHandlers.onCreate));
        plugin.registerEvent(plugin.app.vault.on("modify", boundHandlers.onChange));
        plugin.registerEvent(plugin.app.vault.on("delete", boundHandlers.onDelete));
        plugin.registerEvent(plugin.app.vault.on("rename", boundHandlers.onRename));
        //@ts-ignore : Internal API
        plugin.registerEvent(plugin.app.vault.on("raw", boundHandlers.onRaw));
        if (boundHandlers.onEditorChange) {
            plugin.registerEvent(plugin.app.workspace.on("editor-change", boundHandlers.onEditorChange));
        }

        return Promise.resolve();
    }
}

/**
 * Composite adapter for Obsidian StorageEventManager
 */
export class ObsidianStorageEventManagerAdapter implements IStorageEventManagerAdapter<TFile, TFolder> {
    readonly typeGuard: ObsidianTypeGuardAdapter;
    readonly persistence: ObsidianPersistenceAdapter;
    readonly watch: ObsidianWatchAdapter;
    readonly status: ObsidianStatusAdapter;
    readonly converter: ObsidianConverterAdapter;

    constructor(
        plugin: ObsidianLiveSyncPlugin,
        getStore: () => IncrementalKeyValueStore,
        fileProcessing: FileProcessingService,
        onStoreReplaced?: () => void
    ) {
        this.typeGuard = new ObsidianTypeGuardAdapter();
        this.persistence = new ObsidianPersistenceAdapter(getStore, undefined, onStoreReplaced);
        this.watch = new ObsidianWatchAdapter(plugin);
        this.status = new ObsidianStatusAdapter(fileProcessing);
        this.converter = new ObsidianConverterAdapter();
    }
}
