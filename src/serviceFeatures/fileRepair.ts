import { isNotFoundError } from "@vrtmrz/livesync-commonlib/compat/common/utils.doc";
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
    localDatabase: FileDatabaseInfoCore["localDatabase"] &
        Pick<import("@vrtmrz/livesync-commonlib/compat/pouchdb/LiveSyncLocalDB").LiveSyncLocalDB, "putRaw">;
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

export type DiscardUnreadableRevisionResult = "discarded" | "failed" | "no-longer-live" | "revision-is-readable";

export type DiscardLiveBranchResult = "discarded" | "failed" | "no-longer-live" | "only-live-revision";

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
    const winnerRepresentsStoredFile = winner !== undefined && !winner.metadata.deleted;
    const databaseAndStorageDiffer =
        information.storage.exists !== winnerRepresentsStoredFile ||
        (information.storage.exists && winnerRepresentsStoredFile && winner.contentMatchesStorage === false);
    const unreadableLiveRevision =
        information.database.unavailableConflictRevisions.length > 0 ||
        revisions.some(({ contentReadable }) => !contentReadable);
    const requiresAttention =
        databaseAndStorageDiffer ||
        information.database.conflictCount > 0 ||
        unreadableLiveRevision ||
        revisions.some(
            ({ loadedEntry, metadata }) =>
                loadedEntry !== false && readAsBlob(loadedEntry).size !== metadata.recordedSize
        ) ||
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
    const liveRevisions = [latest.database.currentRevision, ...latest.database.conflictRevisions].filter(
        (candidate): candidate is string => candidate !== null
    );
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

export async function discardLiveBranch(
    core: FileRepairCore,
    path: string,
    revision: string
): Promise<DiscardLiveBranchResult> {
    const latest = await inspectFileDatabaseInfo(core, path);
    const liveRevisions = [latest.database.currentRevision, ...latest.database.conflictRevisions].filter(
        (candidate): candidate is string => candidate !== null
    );
    if (!liveRevisions.includes(revision)) {
        return "no-longer-live";
    }
    if (liveRevisions.length < 2) {
        return "only-live-revision";
    }

    const deleted = await core.fileHandler.deleteRevisionFromDB(latest.databasePath, revision);
    return deleted ? "discarded" : "failed";
}

export function canRepairRevisionSize(inspection: FileRepairInspection, revision: FileRepairRevision): boolean {
    return (
        revision.role === "winner" &&
        revision.metadata.current &&
        revision.metadata.revision !== null &&
        revision.metadata.revision === inspection.information.database.currentRevision &&
        revision.contentReadable &&
        !revision.metadata.deleted &&
        revision.metadata.storageLayout === "chunked" &&
        inspection.information.database.conflictCount === 0 &&
        inspection.information.database.unavailableConflictRevisions.length === 0 &&
        inspection.information.storage.exists &&
        revision.contentMatchesStorage === true &&
        revision.loadedEntry !== false &&
        readAsBlob(revision.loadedEntry).size !== revision.metadata.recordedSize
    );
}

export async function repairRevisionSize(
    core: FileRepairCore,
    path: string,
    revision: string
): Promise<"repaired" | "unchanged" | "stale" | "unsafe" | "failed"> {
    const inspection = await inspectFileRepair(core, path);
    if (inspection.information.database.currentRevision !== revision) return "stale";
    const winner = inspection.revisions.find((candidate) => candidate.role === "winner");
    if (!winner || winner.loadedEntry === false) return "unsafe";
    if (!canRepairRevisionSize(inspection, winner)) {
        return !winner.metadata.deleted &&
            winner.contentMatchesStorage === true &&
            inspection.information.database.conflictCount === 0 &&
            readAsBlob(winner.loadedEntry).size === winner.metadata.recordedSize
            ? "unchanged"
            : "unsafe";
    }
    const content = readAsBlob(winner.loadedEntry);
    const raw = await core.localDatabase.localDatabase
        .get(winner.metadata.documentId, { conflicts: true })
        .catch((error: unknown) => {
            if (isNotFoundError(error)) return false as const;
            throw error;
        });
    if (raw === false) return "stale";
    if (
        (raw.type !== "plain" && raw.type !== "newnote") ||
        raw._rev !== revision ||
        raw._deleted ||
        ("deleted" in raw && raw.deleted) ||
        raw._conflicts?.length
    )
        return "stale";
    if (
        !(await core.storageAccess.isExistsIncludeHidden(path)) ||
        !(await isDocContentSame(content, createBlob(await core.storageAccess.readHiddenFileBinary(path))))
    ) {
        return "unsafe";
    }
    // Preserve the exact stored document; loaded content must never be embedded in Metadata.
    const corrected = { ...raw, size: content.size };
    delete corrected._conflicts;
    delete corrected._revs_info;
    delete corrected._revisions;
    try {
        const result = await core.localDatabase.putRaw(corrected);
        return result.ok ? "repaired" : "failed";
    } catch (error) {
        if ((error as { status?: number }).status === 409) return "stale";
        throw error;
    }
}
