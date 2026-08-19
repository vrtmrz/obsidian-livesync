import type { FilePath, FilePathWithPrefix, UXFileInfo } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { readAsBlob } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type { IFileHandler } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

export type DocumentHistoryRestorationCore = {
    databaseFileAccess: Pick<
        DatabaseFileAccess,
        "fetchEntry" | "fetchEntryMeta" | "getConflictedRevs" | "storeWithLiveBaseRevision"
    >;
    fileHandler: Pick<IFileHandler, "dbToStorageWithSpecificRev">;
};

export type DocumentHistoryRestorationResult =
    | {
          status: "restored";
          path: FilePath;
          revision: string;
          conflictsRemain: boolean | undefined;
          conflictCheckError?: unknown;
      }
    | { status: "source-unavailable" }
    | { status: "current-unavailable" }
    | { status: "unsupported-path" }
    | { status: "database-write-refused" }
    | { status: "stored-not-reflected"; path: FilePath; revision: string; cause?: unknown };

export type DocumentHistoryRestorationOptions = {
    now?: () => number;
    isPathValid?: (path: FilePath) => boolean;
};

/**
 * Restore historical content as a new child of the current database winner, then reflect
 * that exact new revision to the Vault. The historical revision supplies content, not ancestry.
 */
export async function restoreDocumentHistoryRevision(
    core: DocumentHistoryRestorationCore,
    path: FilePathWithPrefix,
    sourceRevision: string,
    options: DocumentHistoryRestorationOptions = {}
): Promise<DocumentHistoryRestorationResult> {
    const now = options.now ?? Date.now;
    const isPathValid = options.isPathValid ?? (() => true);
    const source = await core.databaseFileAccess.fetchEntry(path, sourceRevision, true, true);
    if (source === false) {
        return { status: "source-unavailable" };
    }

    const current = await core.databaseFileAccess.fetchEntryMeta(path, undefined, true);
    if (current === false || !current._rev) {
        return { status: "current-unavailable" };
    }

    const body = readAsBlob(source);
    const storagePath = stripAllPrefixes(current.path);
    if (storagePath !== current.path || !isPathValid(storagePath)) {
        return { status: "unsupported-path" };
    }
    const file: UXFileInfo = {
        name: storagePath.split("/").pop() ?? storagePath,
        path: storagePath,
        stat: {
            ctime: current.ctime,
            mtime: now(),
            size: body.size,
            type: "file",
        },
        body,
    };
    const revision = await core.databaseFileAccess.storeWithLiveBaseRevision(file, current._rev, true);
    if (revision === false) {
        return { status: "database-write-refused" };
    }

    try {
        const reflected = await core.fileHandler.dbToStorageWithSpecificRev(storagePath, revision, true);
        if (!reflected) {
            return { status: "stored-not-reflected", path: storagePath, revision };
        }
    } catch (cause) {
        return { status: "stored-not-reflected", path: storagePath, revision, cause };
    }

    try {
        const conflictsRemain = (await core.databaseFileAccess.getConflictedRevs(storagePath)).length > 0;
        return { status: "restored", path: storagePath, revision, conflictsRemain };
    } catch (conflictCheckError) {
        return {
            status: "restored",
            path: storagePath,
            revision,
            conflictsRemain: undefined,
            conflictCheckError,
        };
    }
}
