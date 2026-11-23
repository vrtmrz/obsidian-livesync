import { IDBKeyValueDatabase } from "../../../src/common/KeyValueDBv2";
import {
    ObsidianPersistenceAdapter,
    StorageEventPersistenceInterrupted,
} from "../../../src/managers/ObsidianStorageEventManagerAdapter";
import {
    StorageEventManagerBase,
    type QueuedFileEvent,
    type StorageEventManagerBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import type { FileEventItem, FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type {
    IStorageEventIncrementalPersistenceAdapter,
    StorageEventSnapshotRecord,
} from "@vrtmrz/livesync-commonlib/storage";
import type { IStorageEventManagerAdapter } from "@vrtmrz/livesync-commonlib/compat/managers/adapters";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import { promiseWithResolvers } from "octagonal-wheels/promises";

const entryCount = 7_453;
const chunkSize = 200;
const sentinelInterval = 17;
const legacyKey = "storage-event-manager-snapshot";
const metaKey = ["storage-event-manager-meta", "state"];
const entryRange = () =>
    IDBKeyRange.bound(["storage-event-manager-entry", 0], ["storage-event-manager-entry", []], true, true);
const sentinelType = "SENTINEL_FLUSH" satisfies QueuedFileEvent["type"];

function requireCondition(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function equalJson(actual: unknown, expected: unknown, message: string): void {
    requireCondition(JSON.stringify(actual) === JSON.stringify(expected), message);
}

function makeFixture() {
    const legacy: QueuedFileEvent[] = [];
    const records: StorageEventSnapshotRecord[] = [];
    const handlerOrder: string[] = [];
    const paths = new Set<string>();
    let cached = 0;
    let filteredRenames = 0;
    for (let index = 0; index < entryCount; index++) {
        const slot = index % sentinelInterval;
        let event: QueuedFileEvent;
        if (slot === 0) {
            event = { type: sentinelType };
            legacy.push(event);
        } else {
            const name = `note-${slot}.md`;
            const path = `notes/folder-${Math.floor(index / sentinelInterval) % 47}/${name}` as FilePath;
            const text = `## Note ${index}\n\nRenderer persistence sample with cached Markdown text.\n\n`
                .repeat(40)
                .slice(0, 2_048);
            const key = `legacy-${index}`;
            event = {
                type: slot === 8 ? "DELETE" : "CHANGED",
                key,
                args: { file: { name, path, stat: { type: "file", ctime: 1, mtime: index + 1, size: text.length } } },
            };
            if (event.type === "DELETE") {
                event.args.renameTarget = `excluded/${name}`;
                filteredRenames++;
            }
            const cache = slot % 2 === 1 ? { cache: text } : {};
            cached += Number("cache" in cache);
            legacy.push({
                ...event,
                args: { ...event.args, ...cache },
                restoredFromPreviousRuntime: true,
                skipBatchWait: true,
            });
            handlerOrder.push(key);
            paths.add(path);
        }
        records.push({ id: String(index + 1).padStart(12, "0"), event });
    }
    return {
        legacy,
        records,
        handlerOrder,
        metadata: {
            entries: legacy.length,
            cacheEntries: cached,
            cacheBytesPerEntry: 2_048,
            handlers: handlerOrder.length,
            distinctPaths: paths.size,
            duplicatePaths: handlerOrder.length - paths.size,
            filteredRenames,
            sentinels: legacy.length - handlerOrder.length,
            chunkSize,
            stagingChunks: Math.ceil(entryCount / chunkSize),
        },
    };
}

type Fixture = ReturnType<typeof makeFixture>;
type Persistence = IStorageEventIncrementalPersistenceAdapter;
type HostAdapter = IStorageEventManagerAdapter<unknown, unknown>;
const unavailable = () => {
    throw new Error("The renderer probe does not invoke Obsidian host services");
};

function rejectHostType(_value: unknown): _value is never {
    return unavailable();
}

interface QueueBookkeeping {
    pendingPathCounts: Map<string, number>;
    pendingSnapshot: Map<QueuedFileEvent, unknown>;
}

class ProbeManager extends StorageEventManagerBase<HostAdapter> {
    // The CPU probe counts work in the production indexes without changing the queue algorithm.
    readonly queueState = this["eventState"] as QueueBookkeeping;

    constructor(
        persistence: Persistence,
        private readonly processEvent: (event: FileEventItem) => Promise<void>
    ) {
        const adapter: HostAdapter = {
            persistence,
            typeGuard: { isFile: rejectHostType, isFolder: rejectHostType },
            watch: { beginWatch: unavailable },
            converter: { toFileInfo: unavailable, toInternalFileInfo: unavailable },
            status: { updateStatus: () => {} },
        };
        // Only settings and logging are used when replaying persisted work with a controlled handler.
        const settings = { ...DEFAULT_SETTINGS, batchSave: false };
        const dependencies = {
            setting: { currentSettings: () => settings },
            APIService: { addLog: () => {} },
        } as unknown as StorageEventManagerBaseDependencies;
        super(adapter, dependencies);
    }

    protected override async handleFileEvent(event: FileEventItem): Promise<void> {
        await this.processEvent(event);
    }

    publishStatus(): void {
        this.updateStatus();
    }
}

function beginReplay(
    persistence: Persistence,
    fixture: Fixture,
    firstHandler?: (manager: ProbeManager, event: FileEventItem) => void
) {
    const handlerOrder: string[] = [];
    const firstGroup = promiseWithResolvers<void>();
    let active = 0;
    let peakHandlers = 0;
    const manager = new ProbeManager(persistence, async (event) => {
        handlerOrder.push(event.key);
        active++;
        peakHandlers = Math.max(peakHandlers, active);
        const started = handlerOrder.length;
        try {
            if (started === 1) {
                firstHandler?.(manager, event);
            }
            if (started === 5) {
                firstGroup.resolve();
            }
            if (started <= 5) {
                await firstGroup.promise;
            }
        } finally {
            active--;
        }
    });
    return {
        manager,
        verify() {
            equalJson(handlerOrder, fixture.handlerOrder, "Restored handler order changed");
            requireCondition(peakHandlers === 5, `Did not exercise the five-handler bound (${peakHandlers})`);
            return { handlers: handlerOrder.length, peakHandlers, exactHandlerOrder: true };
        },
    };
}

async function timedPhase<T>(phase: string, work: () => Promise<T>) {
    const start = performance.mark(`storage-event-probe:${phase}:start`);
    try {
        const result = await work();
        return { result, elapsedMs: performance.now() - start.startTime };
    } finally {
        performance.mark(`storage-event-probe:${phase}:end`);
    }
}

function observePuts() {
    type Batch = { values: unknown[]; completed: Promise<boolean> };
    const batches: Batch[] = [];
    const byTransaction = new WeakMap<IDBTransaction, Batch>();
    const nativePut = IDBObjectStore.prototype.put;
    let maxSynchronousPutMs = 0;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        const start = performance.now();
        const request = nativePut.call(this, value, key);
        maxSynchronousPutMs = Math.max(maxSynchronousPutMs, performance.now() - start);
        const transaction = this.transaction;
        const batch = byTransaction.get(transaction);
        if (batch) {
            batch.values.push(value);
        } else {
            const completed = new Promise<boolean>((resolve) => {
                transaction.addEventListener("complete", () => resolve(true), { once: true });
                transaction.addEventListener("abort", () => resolve(false), { once: true });
            });
            const recorded = { values: [value], completed };
            byTransaction.set(transaction, recorded);
            batches.push(recorded);
        }
        return request;
    };
    return {
        restore() {
            IDBObjectStore.prototype.put = nativePut;
        },
        async summarise() {
            // Wait for the native observers, whose listeners run after the production completion listener.
            const completed = await Promise.all(batches.map((batch) => batch.completed));
            // Encode after the measured phase to exclude JSON serialisation from renderer timings.
            const encoder = new TextEncoder();
            const batchBytes = batches.map(({ values }) =>
                values.reduce<number>((bytes, value) => bytes + encoder.encode(JSON.stringify(value)).length, 0)
            );
            return {
                puts: batches.reduce((count, { values }) => count + values.length, 0),
                completedTransactions: completed.filter(Boolean).length,
                jsonValueBytes: batchBytes.reduce((total, bytes) => total + bytes, 0),
                maxTransactionJsonValueBytes: Math.max(0, ...batchBytes),
                maxSynchronousPutMs,
            };
        },
    };
}

async function measurePuts<T>(phase: string, work: () => Promise<T>) {
    const observer = observePuts();
    try {
        const measured = await timedPhase(phase, work);
        return { ...measured, ...(await observer.summarise()) };
    } finally {
        observer.restore();
    }
}

async function withDatabase<T>(work: (reopen: () => Promise<IDBKeyValueDatabase>) => Promise<T>) {
    const name = `storage-event-persistence-probe-${crypto.randomUUID()}`;
    const handles: IDBKeyValueDatabase[] = [];
    const reopen = async () => {
        const store = new IDBKeyValueDatabase(name);
        handles.push(store);
        await store.getIsReady();
        return store;
    };
    try {
        return await work(reopen);
    } finally {
        for (const handle of handles) {
            await handle.close();
        }
        await new IDBKeyValueDatabase(name).destroy();
    }
}

function recordAcknowledgements(persistence: Persistence) {
    const original = persistence.applySnapshotDelta.bind(persistence);
    let admissionWrites = 0;
    const acknowledgements: string[][] = [];
    persistence.applySnapshotDelta = async (delta) => {
        await original(delta);
        admissionWrites += Number(delta.upsert.length > 0);
        if (delta.remove.length) {
            acknowledgements.push([...delta.remove]);
        }
    };
    return (fixture: Fixture) => {
        requireCondition(admissionWrites === 0, "Restored intents generated admission writes");
        const ids = acknowledgements.flat();
        const positions = new Map(ids.map((id, index) => [id, index]));
        const expected = fixture.records;
        requireCondition(
            ids.length === expected.length && positions.size === expected.length,
            "Missing or duplicate acknowledgements"
        );
        let latestPriorPosition = -1;
        for (const record of expected) {
            const position = positions.get(record.id);
            requireCondition(position !== undefined, `Missing acknowledgement for ${record.id}`);
            if (record.event.type === sentinelType) {
                requireCondition(position > latestPriorPosition, "Sentinel acknowledged before preceding intent");
            }
            latestPriorPosition = Math.max(latestPriorPosition, position);
        }
        return { admissionWrites, acknowledgementCommits: acknowledgements.length, acknowledgedEntries: ids.length };
    };
}

async function runDatabase() {
    const fixture = makeFixture();
    const legacy = await withDatabase(async (reopen) => {
        const store = await reopen();
        const { result: _putKey, ...write } = await measurePuts("legacy", () => store.set(legacyKey, fixture.legacy));
        requireCondition(
            write.puts === 1 && write.completedTransactions === 1,
            `Expected a single legacy commit, saw ${write.puts} puts and ${write.completedTransactions} commits`
        );
        await store.close();
        const reader = await reopen();
        const { result, elapsedMs } = await timedPhase("legacy-get", () => reader.get<QueuedFileEvent[]>(legacyKey));
        equalJson(result, fixture.legacy, "Legacy baseline seed changed");
        return { ...write, getMs: elapsedMs };
    });

    const candidate = await withDatabase(async (reopen) => {
        const writer = await reopen();
        await writer.set(legacyKey, fixture.legacy);
        await writer.close();
        const store = await reopen();
        const getEntries = store.getEntries.bind(store);
        let legacyReadMs = 0;
        let legacyReadCount = 0;
        store.getEntries = async <U>(query?: IDBValidKey | IDBKeyRange, count?: number) => {
            if (query !== legacyKey) {
                return await getEntries<U>(query, count);
            }
            const read = await timedPhase("migration-read", () => getEntries<U>(query, count));
            legacyReadCount++;
            legacyReadMs = read.elapsedMs;
            return read.result;
        };
        const migrationAdapter = new ObsidianPersistenceAdapter(() => store, { migrationChunkSize: chunkSize });
        const { result: migrated, ...migration } = await measurePuts("migration", () =>
            migrationAdapter.loadSnapshotEntries()
        );
        requireCondition(legacyReadCount === 1, "Migration must read the legacy snapshot once");
        equalJson(migrated, fixture.records, "Migrated ordered records changed");
        requireCondition(migration.puts === entryCount + 1, "Expected one put per record plus the cutover marker");
        requireCondition(
            migration.completedTransactions === fixture.metadata.stagingChunks + 1,
            "Unexpected migration batch count"
        );
        requireCondition(
            (await store.get(legacyKey)) === undefined,
            "Downgrade reader still sees a legacy key after cutover"
        );
        await store.close();

        const replayStore = await reopen();
        const adapter = new ObsidianPersistenceAdapter(() => replayStore);
        const verifyAcknowledgements = recordAcknowledgements(adapter);
        const replay = beginReplay(adapter, fixture);
        const { result: _restored, ...replayPuts } = await measurePuts("replay", () => replay.manager.restoreState());
        await replay.manager.stopWatching();
        const writes = verifyAcknowledgements(fixture);
        requireCondition(
            replayPuts.completedTransactions === writes.acknowledgementCommits,
            "Native commits did not match acknowledgement deltas"
        );
        requireCondition(
            replayPuts.puts === writes.acknowledgementCommits,
            "Acknowledgements must put only the metadata marker"
        );
        await replayStore.close();
        const reader = await reopen();
        const readerAdapter = new ObsidianPersistenceAdapter(() => reader);
        equalJson(await readerAdapter.loadSnapshotEntries(), [], "Reopened reader did not return active-empty");
        equalJson(await reader.keys(), [metaKey], "Active-empty store retained unexpected keys");
        requireCondition(
            (await reader.get(legacyKey)) === undefined,
            "Downgrade reader sees legacy data in active-empty"
        );
        await reader.destroy();
        const resetStore = await reopen();
        requireCondition(
            (await new ObsidianPersistenceAdapter(() => resetStore).loadSnapshotEntries()) === null,
            "Reset reader did not return absent"
        );
        equalJson(await resetStore.keys(), [], "Reset store retained keys");
        return {
            migration: { ...migration, legacyReadMs, legacyReadCount },
            replay: { ...replayPuts, ...writes, ...replay.verify() },
            readerStates: { afterReplay: "active-empty", afterDestroy: "absent", legacyKeyAbsentAfterCutover: true },
        };
    });
    return { fixture: fixture.metadata, legacy, ...candidate };
}

async function expectInterrupted(adapter: ObsidianPersistenceAdapter): Promise<void> {
    try {
        await adapter.loadSnapshotEntries();
    } catch (error) {
        requireCondition(
            error instanceof StorageEventPersistenceInterrupted,
            `Unexpected interruption error: ${String(error)}`
        );
        return;
    }
    throw new Error("Migration completed beyond the requested interruption boundary");
}

async function runInterruptions() {
    const fixture = makeFixture();
    return await withDatabase(async (reopen) => {
        const seed = await reopen();
        await seed.set(legacyKey, fixture.legacy);
        await seed.close();
        const staged: number[] = [];
        // Retry the same database from the legacy authority, interrupting one chunk later each time.
        for (let committed = 1; committed <= fixture.metadata.stagingChunks; committed++) {
            const store = await reopen();
            const adapter = new ObsidianPersistenceAdapter(() => store, {
                migrationChunkSize: chunkSize,
                onBeforeStagingChunk: (offset) => {
                    if (offset === committed * chunkSize) {
                        adapter.abortRestore();
                    }
                },
                onBeforeCutover: () => {
                    adapter.abortRestore();
                },
            });
            await expectInterrupted(adapter);
            await store.close();
            const reader = await reopen();
            requireCondition((await reader.get(metaKey)) === undefined, "Active marker appeared during staging");
            const legacyReader = new ObsidianPersistenceAdapter(() => reader);
            equalJson(await legacyReader.loadSnapshot(), fixture.legacy, "Staging modified the legacy authority");
            const entries = await reader.getEntries<StorageEventSnapshotRecord>(entryRange());
            const expectedCount = Math.min(committed * chunkSize, entryCount);
            equalJson(
                entries.map(({ value }) => value),
                fixture.records.slice(0, expectedCount),
                "Reopened staged prefix differs"
            );
            staged.push(entries.length);
            await reader.close();
        }

        const store = await reopen();
        const adapter = new ObsidianPersistenceAdapter(() => store, { migrationChunkSize: chunkSize });
        const applyBatch = store.applyBatch.bind(store);
        store.applyBatch = async (operations, beforeTransaction, signal) => {
            await applyBatch(operations, beforeTransaction, signal);
            if (operations.some(({ type, key }) => type === "delete" && key === legacyKey)) {
                adapter.abortRestore();
            }
        };
        await expectInterrupted(adapter);
        await store.close();
        const reader = await reopen();
        const recovered = new ObsidianPersistenceAdapter(() => reader);
        requireCondition((await reader.get(legacyKey)) === undefined, "Downgrade reader can still see legacy storage");
        equalJson(
            await recovered.loadSnapshotEntries(),
            fixture.records,
            "Interrupted cutover lost or reordered records"
        );
        const cutoverMeta = (await reader.get(metaKey)) as
            | { format?: unknown; highWaterSequence?: unknown; storeId?: unknown }
            | undefined;
        equalJson(
            { format: cutoverMeta?.format, highWaterSequence: cutoverMeta?.highWaterSequence },
            { format: "incremental-v1", highWaterSequence: entryCount },
            "Cutover marker lost its committed high-water sequence"
        );
        requireCondition(
            typeof cutoverMeta?.storeId === "string" && cutoverMeta.storeId.length > 0,
            "Cutover marker is missing its storeId"
        );
        return {
            beforeCutover: { state: "staged", stagedEntriesAfterEachChunk: staged, legacyUnchanged: true },
            afterCutover: { state: "active", entries: entryCount, exactRecordOrder: true, legacyKeyAbsent: true },
        };
    });
}

function measureQueueOperations(manager: ProbeManager, event: FileEventItem, snapshotVisits: () => number) {
    const iterations = 10_000;
    const counts = manager.queueState.pendingPathCounts;
    const originalGet = counts.get;
    let lookups = 0;
    counts.get = (path) => {
        lookups++;
        return originalGet.call(counts, path);
    };
    const before = snapshotVisits();
    try {
        let start = performance.now();
        for (let i = 0; i < iterations; i++) {
            manager.publishStatus();
        }
        const statusMs = performance.now() - start;
        const pendingPaths = [1, 3, 12].map((depth) => {
            const path = `${event.args.file.path}${"/child".repeat(depth - 1)}` as FilePath;
            lookups = 0;
            let hits = 0;
            start = performance.now();
            for (let i = 0; i < iterations; i++) {
                hits += Number(manager.hasPendingFileEvent(path));
            }
            const elapsedMs = performance.now() - start;
            requireCondition(
                hits === iterations && lookups === iterations * depth,
                "Lookup did not follow the expected path depth"
            );
            return { depth, elapsedMs, mapLookups: lookups };
        });
        requireCondition(snapshotVisits() === before, "Status or path lookup iterated pending entries");
        return { iterations, statusMs, pendingPaths, snapshotEntriesVisited: 0 };
    } finally {
        counts.get = originalGet;
    }
}

async function runCpu() {
    const fixture = makeFixture();
    const persistence: Persistence = {
        loadSnapshotEntries: () => Promise.resolve(fixture.records),
        applySnapshotDelta: () => Promise.resolve(),
        loadSnapshot: unavailable,
        saveSnapshot: unavailable,
    };
    const verifyAcknowledgements = recordAcknowledgements(persistence);
    let visited = 0;
    let queueOperations: ReturnType<typeof measureQueueOperations> | undefined;
    const replay = beginReplay(persistence, fixture, (manager, event) => {
        queueOperations = measureQueueOperations(manager, event, () => visited);
    });
    const snapshot = replay.manager.queueState.pendingSnapshot;
    const values = snapshot.values.bind(snapshot);
    snapshot.values = () => {
        const iterator = values();
        const next = iterator.next.bind(iterator);
        iterator.next = () => {
            const entry = next();
            visited += Number(!entry.done);
            return entry;
        };
        return iterator;
    };
    const { elapsedMs } = await timedPhase("cpu", () => replay.manager.restoreState());
    await replay.manager.stopWatching();
    const writes = verifyAcknowledgements(fixture);
    requireCondition(queueOperations, "Queue operations were not measured");
    requireCondition(visited < entryCount * 6, "Delta and sentinel bookkeeping visited the whole queue per write");
    return {
        elapsedMs,
        queueOperations,
        ...replay.verify(),
        ...writes,
        snapshotEntriesVisited: visited,
        visitsPerEntry: visited / entryCount,
        indexedDbWrites: 0,
    };
}

declare global {
    interface Window {
        runStorageEventDatabaseProbe: typeof runDatabase;
        runStorageEventInterruptions: typeof runInterruptions;
        runStorageEventCpuProbe: typeof runCpu;
    }
}

window.runStorageEventDatabaseProbe = runDatabase;
window.runStorageEventInterruptions = runInterruptions;
window.runStorageEventCpuProbe = runCpu;
