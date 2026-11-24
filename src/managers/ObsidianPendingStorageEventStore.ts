import type { IDBKeyValueDatabase } from "@/common/KeyValueDBv2";
import type { FileEventItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { FileEventItemSentinel } from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import type {
    PendingStorageEventBuffer,
    PendingStorageEventStore,
} from "@vrtmrz/livesync-commonlib/compat/managers/adapters";

const legacyKey = "storage-event-manager-snapshot";
const bufferPrefix = "storageEventBuffer/";
const sequenceKey = "storageEventBufferSequence";

function readBuffer(key: string, value: unknown): PendingStorageEventBuffer {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid pending storage event buffer: ${key}`);
    }
    return { key, events: value };
}

export class ObsidianPendingStorageEventStore implements PendingStorageEventStore {
    constructor(private readonly database: () => IDBKeyValueDatabase) {}

    load(): Promise<readonly PendingStorageEventBuffer[]> {
        return this.database().withStore("readonly", async (store) => {
            const range = IDBKeyRange.bound(bufferPrefix, bufferPrefix + "\uffff", false, true);
            const [legacy, keys, arrays] = await Promise.all<[unknown, IDBValidKey[], unknown[]]>([
                store.get(legacyKey),
                store.getAllKeys(range),
                store.getAll(range),
            ]);
            // Keep the old array as the first buffer. Recovery removes it once every event has settled.
            const result = legacy === undefined ? [] : [readBuffer(legacyKey, legacy)];
            for (const [index, key] of keys.entries()) {
                if (typeof key !== "string") {
                    throw new Error("Invalid pending storage event buffer key");
                }
                result.push(readBuffer(key, arrays[index]));
            }
            return result;
        });
    }

    append(events: readonly (FileEventItem | FileEventItemSentinel)[]): Promise<string> {
        return this.database().withStore("readwrite", async (store) => {
            const previous: unknown = (await store.get(sequenceKey)) ?? 0;
            if (
                typeof previous !== "number" ||
                !Number.isSafeInteger(previous) ||
                previous < 0 ||
                previous === Number.MAX_SAFE_INTEGER
            ) {
                throw new Error("Invalid pending storage event buffer sequence");
            }
            const sequence = previous + 1;
            const key = bufferPrefix + String(sequence).padStart(16, "0");
            await store.add(events, key);
            await store.put(sequence, sequenceKey);
            return key;
        });
    }

    async remove(key: string): Promise<void> {
        if (key !== legacyKey && !key.startsWith(bufferPrefix)) {
            throw new Error("Invalid pending storage event buffer key");
        }
        await this.database().del(key);
    }
}
