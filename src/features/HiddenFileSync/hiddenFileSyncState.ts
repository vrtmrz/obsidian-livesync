import type {
    FilePathWithPrefix,
    LoadedEntry,
    MetaEntry,
    UXFileInfo,
    UXStat,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { displayRev } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

export function toHiddenFileSyncStorageStateKey(stat: UXStat | null): string {
    return `${stat?.mtime ?? 0}-${stat?.size ?? 0}`;
}

export function toHiddenFileSyncDatabaseStateKey(doc: LoadedEntry | MetaEntry): string {
    // Compatibility: the deletion marker includes its own hyphen, producing `--0`
    // or `--1` after the revision. Existing device-local state uses this format.
    return `${doc.mtime}-${doc.size}-${doc._rev}-${doc._deleted || doc.deleted || false ? "-0" : "-1"}`;
}

export function getHiddenFileSyncComparisonMTime(
    source: MetaEntry | LoadedEntry | UXFileInfo | UXStat | false | null | undefined,
    includeDeleted = false
): number {
    if (source === null || source === false || source === undefined) return 0;
    if (!includeDeleted) {
        if ("deleted" in source && source.deleted) return 0;
        if ("_deleted" in source && source._deleted) return 0;
    }
    if ("stat" in source) return source.stat?.mtime ?? 0;
    return source.mtime ?? 0;
}

export function describeHiddenFileSyncDocument(doc: LoadedEntry, prefixedPath: FilePathWithPrefix) {
    const id = doc._id;
    const path = stripAllPrefixes(prefixedPath);
    const rev = doc._rev;
    return {
        id,
        rev,
        revDisplay: rev ? displayRev(rev) : "0-NOREVS",
        prefixedPath,
        path,
        isDeleted: doc._deleted || doc.deleted || false,
        shortenedId: id.substring(0, 10),
        shortenedPath: path.substring(0, 10),
    };
}
