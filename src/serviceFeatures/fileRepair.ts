import type { LoadedEntry } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createBlob, isDocContentSame, readAsBlob } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import type { IFileHandler } from "@vrtmrz/livesync-commonlib/compat/interfaces/FileHandler";
import {
    inspectFileDatabaseInfo,
    readFileDatabaseRevisionLocally,
    type FileDatabaseInfo,
    type FileDatabaseInfoCore,
    type RevisionDatabaseInfo,
} from "./fileDatabaseInfo";

export type FileRepairCore = FileDatabaseInfoCore & {
    fileHandler: Pick<IFileHandler, "deleteRevisionFromDB">;
    storageAccess: FileDatabaseInfoCore["storageAccess"] & Pick<StorageAccess, "readHiddenFileBinary">;
};

export type FileRepairRevision = {
    role: "winner" | "conflict";
    metadata: RevisionDatabaseInfo;
    contentReadable: boolean;
    contentMatchesStorage: boolean | null;
    loadedEntry: LoadedEntry | false;
};

export type FileRepairInspection = {
    information: FileDatabaseInfo;
    revisions: FileRepairRevision[];
    requiresAttention: boolean;
};

export type DiscardUnreadableRevisionResult =
    | "discarded"
    | "failed"
    | "no-longer-live"
    | "revision-is-readable";

export async function inspectFileRepair(core: FileRepairCore, path: string): Promise<FileRepairInspection> {
    const information = await inspectFileDatabaseInfo(core, path);
    const storageContent = information.storage.exists
        ? createBlob(await core.storageAccess.readHiddenFileBinary(path))
        : undefined;
    const revisions: FileRepairRevision[] = [];

    for (const metadata of information.database.revisions) {
        const loadedEntry =
            metadata.deleted || !metadata.contentAvailableLocally
                ? false
                : await readFileDatabaseRevisionLocally(core, path, metadata.revision ?? "");
        const contentReadable = metadata.deleted || loadedEntry !== false;
        const contentMatchesStorage =
            storageContent && loadedEntry !== false
                ? await isDocContentSame(storageContent, readAsBlob(loadedEntry))
                : null;
        revisions.push({
            role: metadata.current ? "winner" : "conflict",
            metadata,
            contentReadable,
            contentMatchesStorage,
            loadedEntry,
        });
    }

    const winner = revisions.find(({ role }) => role === "winner");
    const databaseAndStorageDiffer =
        information.storage.exists !== information.database.exists ||
        (information.storage.exists &&
            winner !== undefined &&
            (winner.metadata.deleted || winner.contentMatchesStorage === false)) ||
        (!information.storage.exists && winner !== undefined && !winner.metadata.deleted);
    const unreadableLiveRevision =
        information.database.unavailableConflictRevisions.length > 0 ||
        revisions.some(({ contentReadable }) => !contentReadable);
    const requiresAttention =
        databaseAndStorageDiffer ||
        information.database.conflictCount > 0 ||
        unreadableLiveRevision ||
        (information.database.exists && winner === undefined);

    return {
        information,
        revisions,
        requiresAttention,
    };
}

export async function discardUnreadableLiveRevision(
    core: FileRepairCore,
    path: string,
    revision: string
): Promise<DiscardUnreadableRevisionResult> {
    const latest = await inspectFileDatabaseInfo(core, path);
    const liveRevisions = [
        latest.database.currentRevision,
        ...latest.database.conflictRevisions,
    ].filter((candidate): candidate is string => candidate !== null);
    if (!liveRevisions.includes(revision)) {
        return "no-longer-live";
    }

    const metadata = latest.database.revisions.find((candidate) => candidate.revision === revision);
    const metadataUnavailable = latest.database.unavailableConflictRevisions.includes(revision);
    if (!metadataUnavailable && (metadata?.deleted || metadata?.contentAvailableLocally)) {
        return "revision-is-readable";
    }

    const deleted = await core.fileHandler.deleteRevisionFromDB(latest.databasePath, revision);
    return deleted ? "discarded" : "failed";
}
