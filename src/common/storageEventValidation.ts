import type { FileEventItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type {
    FileEventItemSentinel,
    QueuedFileEvent,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";

type StoredStorageEvent = FileEventItemSentinel | (Omit<FileEventItem, "key"> & { key?: string });

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isOptionalBoolean = (value: unknown): boolean => value === undefined || typeof value === "boolean";
const isOptionalPath = (value: unknown): boolean => value === undefined || typeof value === "string";

function isFileStat(value: unknown): boolean {
    return (
        isRecord(value) &&
        value.type === "file" &&
        Number.isFinite(value.ctime) &&
        Number.isFinite(value.mtime) &&
        Number.isFinite(value.size)
    );
}

function isPersistedFile(file: unknown, type: string): boolean {
    if (!isRecord(file) || !isNonEmptyString(file.path) || typeof file.name !== "string") {
        return false;
    }
    if (file.isFolder !== undefined && file.isFolder !== false) {
        return false;
    }
    if (!isOptionalBoolean(file.isInternal) || !isOptionalBoolean(file.deleted)) {
        return false;
    }
    return isFileStat(file.stat) || (type === "INTERNAL" && file.stat === undefined);
}

function isStoredStorageEvent(value: unknown): value is StoredStorageEvent {
    if (!isRecord(value)) {
        return false;
    }
    switch (value.type) {
        case "SENTINEL_FLUSH":
            return true;
        case "CREATE":
        case "CHANGED":
        case "DELETE":
        case "RENAME":
        case "INTERNAL":
            break;
        default:
            return false;
    }

    return (
        (value.key === undefined || isNonEmptyString(value.key)) &&
        isOptionalBoolean(value.cancelled) &&
        isOptionalBoolean(value.batched) &&
        isOptionalBoolean(value.skipBatchWait) &&
        isRecord(value.args) &&
        isPersistedFile(value.args.file, value.type) &&
        isOptionalPath(value.args.oldPath) &&
        isOptionalPath(value.args.renameTarget) &&
        (value.type !== "RENAME" || isNonEmptyString(value.args.oldPath))
    );
}

export function readStorageEvent(value: unknown): QueuedFileEvent | null {
    if (!isStoredStorageEvent(value)) {
        return null;
    }
    if (value.type === "SENTINEL_FLUSH") {
        return value;
    }
    // Older snapshots can omit the queue key. The path still identifies the file.
    return { ...value, key: value.key ?? value.args.file.path };
}

export function readStorageEvents(events: unknown[]): QueuedFileEvent[] | null {
    const restored: QueuedFileEvent[] = [];
    for (const event of events) {
        const item = readStorageEvent(event);
        if (!item) {
            return null;
        }
        restored.push(item);
    }
    return restored;
}
