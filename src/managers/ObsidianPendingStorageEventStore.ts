import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
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
    private reportedInvalidLegacySnapshot = false;

    constructor(private readonly database: () => Pick<IDBKeyValueDatabase, "withStore" | "del">) {}

    async load(): Promise<readonly PendingStorageEventBuffer[]> {
        const database = this.database();
        const { buffers, invalidLegacy } = await database.withStore("readonly", async (store) => {
            const range = IDBKeyRange.bound(bufferPrefix, bufferPrefix + "\uffff", false, true);
            // An exact-key getAll distinguishes a missing record from a stored undefined.
            const [legacyRecords, keys, arrays]: [unknown[], IDBValidKey[], unknown[]] = await Promise.all([
                store.getAll(legacyKey, 1),
                store.getAllKeys(range),
                store.getAll(range),
            ]);
            // Keep the old array as the first buffer. Recovery removes it once every event has settled.
            const [legacy] = legacyRecords;
            const result: PendingStorageEventBuffer[] = Array.isArray(legacy)
                ? [{ key: legacyKey, events: legacy }]
                : [];
            for (const [index, key] of keys.entries()) {
                if (typeof key !== "string") {
                    throw new Error("Invalid pending storage event buffer key");
                }
                result.push(readBuffer(key, arrays[index]));
            }
            return { buffers: result, invalidLegacy: legacyRecords.length > 0 && !Array.isArray(legacy) };
        });

        if (invalidLegacy) {
            try {
                await database.withStore("readwrite", async (store) => {
                    // A writer may have replaced the snapshot since the read-only transaction.
                    const records: unknown[] = await store.getAll(legacyKey, 1);
                    if (records.length > 0 && !Array.isArray(records[0])) {
                        await store.delete(legacyKey);
                    }
                });
            } catch {
                Logger("Could not remove the invalid legacy storage event snapshot.", LOG_LEVEL_VERBOSE);
            }
            if (!this.reportedInvalidLegacySnapshot) {
                this.reportedInvalidLegacySnapshot = true;
                Logger("LiveSync ignored an unexpected item while restoring pending file changes.", LOG_LEVEL_NOTICE);
            }
        }
        return buffers;
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
