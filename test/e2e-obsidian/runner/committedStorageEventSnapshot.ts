import type { StorageEventSnapshotRecord } from "@vrtmrz/livesync-commonlib/storage";

type LegacyEvent = StorageEventSnapshotRecord["event"];
type Metadata = { format: "incremental-v1"; highWaterSequence: number };

async function readCommittedStorageEventSnapshot(databaseName: string) {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        return await new Promise<{
            legacy: LegacyEvent[] | undefined;
            metadata: Metadata | undefined;
            entries: Array<StorageEventSnapshotRecord & { key: IDBValidKey }>;
            events: LegacyEvent[] | null;
        }>((resolve, reject) => {
            const transaction = database.transaction(databaseName, "readonly");
            const store = transaction.objectStore(databaseName);
            const prefix = "storage-event-manager-entry";
            const range = IDBKeyRange.bound([prefix], [prefix + "\0"], false, true);
            const legacy = store.getAll("storage-event-manager-snapshot", 1);
            const metadata = store.getAll(["storage-event-manager-meta", "state"], 1);
            const keys = store.getAllKeys(range);
            const records = store.getAll(range);
            transaction.oncomplete = () => {
                const [legacyEvents] = legacy.result as [LegacyEvent[]?];
                const [activeMeta] = metadata.result as [Metadata?];
                if (legacy.result.length > 0 && !Array.isArray(legacyEvents)) {
                    reject(new Error("Invalid legacy storage event snapshot"));
                    return;
                }
                if (metadata.result.length > 0 && activeMeta?.format !== "incremental-v1") {
                    reject(new Error("Invalid incremental storage event metadata"));
                    return;
                }
                const entries = (records.result as StorageEventSnapshotRecord[]).map((record, index) => ({
                    ...record,
                    key: keys.result[index],
                }));
                if (!activeMeta && !legacyEvents && entries.length > 0) {
                    reject(new Error("Orphaned incremental storage event records"));
                    return;
                }
                resolve({
                    legacy: legacyEvents,
                    metadata: activeMeta,
                    entries,
                    events: activeMeta
                        ? [...entries.map((record) => record.event), ...(legacyEvents ?? [])]
                        : (legacyEvents ?? null),
                });
            };
            transaction.onabort = () => reject(transaction.error);
        });
    } finally {
        database.close();
    }
}

// Evaluate inside the Obsidian renderer. The reader never opens the production adapter.
export const readCommittedStorageEventSnapshotSource = readCommittedStorageEventSnapshot.toString();
