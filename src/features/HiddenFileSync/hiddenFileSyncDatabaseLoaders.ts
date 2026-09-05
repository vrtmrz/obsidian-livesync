import {
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type FilePath,
    type FilePathWithPrefix,
    type LoadedEntry,
    type LOG_LEVEL,
    type MetaEntry,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type { LiveSyncLocalDB } from "@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB";
import type { IPathService } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { addPrefix, stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

import { ICHeader } from "@/common/types.ts";

type HiddenFileSyncLogDependency = {
    log: LogFunction;
};

type HiddenFileSyncDatabaseMethods<Method extends keyof LiveSyncLocalDB> = {
    getLocalDatabase(): Pick<LiveSyncLocalDB, Method>;
};

type HiddenFileSyncDatabaseFileAccessMethods<Method extends keyof DatabaseFileAccess> = {
    databaseFileAccess: Pick<DatabaseFileAccess, Method>;
};

type HiddenFileSyncPathMethods<Method extends keyof IPathService> = {
    path: Pick<IPathService, Method>;
};

export type HiddenFileSyncBaseEntryLoaderDependencies = HiddenFileSyncDatabaseMethods<"getDBEntry" | "getDBEntryMeta"> &
    HiddenFileSyncPathMethods<"path2id"> &
    HiddenFileSyncLogDependency;

export type HiddenFileSyncLiveRevisionLoaderDependencies = HiddenFileSyncDatabaseFileAccessMethods<
    "fetchEntryMeta" | "getConflictedRevs"
> &
    HiddenFileSyncLogDependency;

function log(dependencies: HiddenFileSyncLogDependency, message: unknown, level?: LOG_LEVEL, key?: string): void {
    dependencies.log(message, level, key);
}

export async function loadHiddenFileSyncBaseEntry(
    dependencies: HiddenFileSyncBaseEntryLoaderDependencies,
    file: FilePath,
    includeContent = true
): Promise<LoadedEntry | false> {
    const prefixedFileName = addPrefix(file, ICHeader);
    // Compatibility question: path-to-ID conversion is performed even when an
    // entry already exists, and it sits outside the guarded database lookup.
    // Preserve this ordering and error propagation until reviewed separately.
    const id = await dependencies.path.path2id(prefixedFileName, ICHeader);
    try {
        const old = includeContent
            ? await dependencies.getLocalDatabase().getDBEntry(prefixedFileName, undefined, false, true)
            : await dependencies.getLocalDatabase().getDBEntryMeta(prefixedFileName, { conflicts: true }, true);
        if (old !== false) {
            return old;
        }
        // Compatibility question: getDBEntry() also returns false when content
        // or Chunks cannot be read. The inherited behaviour treats that exactly
        // like absence and synthesises a fresh base entry.
        return {
            _id: id,
            data: [],
            path: prefixedFileName,
            mtime: 0,
            ctime: 0,
            datatype: "newnote",
            children: [],
            size: 0,
            deleted: false,
            type: "newnote",
            eden: {},
        };
    } catch (error) {
        log(dependencies, "Getting base save data failed");
        log(dependencies, error, LOG_LEVEL_VERBOSE);
        return false;
    }
}

export async function loadLiveHiddenFileSyncRevision(
    dependencies: HiddenFileSyncLiveRevisionLoaderDependencies,
    prefixedFileName: FilePathWithPrefix,
    revision: string
): Promise<MetaEntry | false> {
    const [selected, current, conflicts] = await Promise.all([
        dependencies.databaseFileAccess.fetchEntryMeta(prefixedFileName, revision, true),
        dependencies.databaseFileAccess.fetchEntryMeta(prefixedFileName, undefined, true),
        dependencies.databaseFileAccess.getConflictedRevs(prefixedFileName),
    ]);
    const liveRevisions = new Set([...(current && current._rev ? [current._rev] : []), ...conflicts]);
    if (!selected || selected._rev !== revision || !liveRevisions.has(revision)) {
        // Compatibility: missing, mismatched, and stale selections share the
        // same user-facing diagnostic and false result.
        log(
            dependencies,
            `Could not use hidden-file revision ${revision} of ${stripAllPrefixes(prefixedFileName)}; the selected revision is no longer live`,
            LOG_LEVEL_NOTICE
        );
        return false;
    }
    // Compatibility: liveness is revision-tree membership only. A deleted
    // Metadata leaf remains selectable while its revision is still live.
    return selected;
}
