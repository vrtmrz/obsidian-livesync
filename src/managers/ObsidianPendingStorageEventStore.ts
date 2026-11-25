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
const timestampBufferPrefix = `${bufferPrefix}t`;
const keyPartWidth = 16;

function getBufferTimestamp(key: string): number | undefined {
    const match = /^storageEventBuffer\/t(\d{16})\.\d{16}$/.exec(key);
    if (!match) {
        return undefined;
    }
    const timestamp = Number(match[1]);
    return Number.isSafeInteger(timestamp) ? timestamp : undefined;
}

function readBuffer(key: string, value: unknown): PendingStorageEventBuffer {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid pending storage event buffer: ${key}`);
    }
    return { key, events: value };
}

function omitFunctionContexts(events: readonly (FileEventItem | FileEventItemSentinel)[]) {
    if (!events.some((event) => "args" in event && typeof event.args.ctx === "function")) {
        return events;
    }
    return events.map((event) => {
        if (!("args" in event) || typeof event.args.ctx !== "function") {
            return event;
        }
        const args = { ...event.args };
        delete args.ctx;
        return { ...event, args };
    });
}

export class ObsidianPendingStorageEventStore implements PendingStorageEventStore {
    private reportedInvalidLegacySnapshot = false;
    // Keep these instance-scoped so database resets cannot reuse pending buffer keys.
    private baseNow: number | undefined;
    private sequence = 0;

    constructor(private readonly database: () => Pick<IDBKeyValueDatabase, "withStore" | "del">) {}

    private initializeBaseNow(maxPendingTimestamp: number | undefined): number {
        if (this.baseNow !== undefined) {
            return this.baseNow;
        }
        const now = Date.now();
        const nextPendingTimestamp = maxPendingTimestamp === undefined ? now : maxPendingTimestamp + 1;
        const baseNow = Math.max(now, nextPendingTimestamp);
        if (!Number.isSafeInteger(baseNow) || baseNow < 0) {
            throw new Error("Invalid pending storage event buffer timestamp");
        }
        this.baseNow = baseNow;
        return baseNow;
    }

    async load(): Promise<readonly PendingStorageEventBuffer[]> {
        const database = this.database();
        const { buffers, invalidLegacy, maxPendingTimestamp } = await database.withStore("readonly", async (store) => {
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
            let maxPendingTimestamp: number | undefined;
            for (const [index, key] of keys.entries()) {
                if (typeof key !== "string") {
                    throw new Error("Invalid pending storage event buffer key");
                }
                const timestamp = getBufferTimestamp(key);
                if (timestamp !== undefined) {
                    maxPendingTimestamp = timestamp;
                }
                result.push(readBuffer(key, arrays[index]));
            }
            return {
                buffers: result,
                invalidLegacy: legacyRecords.length > 0 && !Array.isArray(legacy),
                maxPendingTimestamp,
            };
        });

        this.initializeBaseNow(maxPendingTimestamp);

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
            let baseNow = this.baseNow;
            if (baseNow === undefined) {
                const range = IDBKeyRange.bound(timestampBufferPrefix, timestampBufferPrefix + "\uffff", false, true);
                let cursor = await store.openKeyCursor(range, "prev");
                let maxPendingTimestamp: number | undefined;
                while (cursor) {
                    if (typeof cursor.key === "string") {
                        maxPendingTimestamp = getBufferTimestamp(cursor.key);
                        if (maxPendingTimestamp !== undefined) {
                            break;
                        }
                    }
                    cursor = await cursor.continue();
                }
                baseNow = this.initializeBaseNow(maxPendingTimestamp);
            }

            if (this.sequence >= Number.MAX_SAFE_INTEGER) {
                throw new Error("Invalid pending storage event buffer sequence");
            }
            const timestamp = baseNow;
            const sequence = this.sequence + 1;
            this.sequence = sequence;
            const key = `${timestampBufferPrefix}${String(timestamp).padStart(keyPartWidth, "0")}.${String(sequence).padStart(keyPartWidth, "0")}`;
            await store.add(omitFunctionContexts(events), key);
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
