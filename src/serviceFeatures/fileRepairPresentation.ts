import {
    BASE_IS_NEW,
    EVEN,
    TARGET_IS_NEW,
} from "@vrtmrz/livesync-commonlib/compat/common/models/shared.const.symbols";
import {
    compareMTime,
    readAsBlob,
} from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { isPlainText } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import type {
    FileRepairInspection,
    FileRepairRevision,
} from "./fileRepair";

export type FileRepairRevisionActions = {
    compareWithVault: boolean;
    applyRevisionToVault: boolean;
    markAsVaultRevision: boolean;
    storeVaultOnBranch: boolean;
    applyLogicalDeletionToVault: boolean;
    retryRevision: boolean;
    discardBranch: boolean;
    discardRevision: boolean;
};

export type FileRepairTimestampRelation =
    | "vault-newer"
    | "database-newer"
    | "same-window"
    | "unavailable";

export type FileRepairRevisionComparison = {
    recordedSize: number;
    decodedSize: number | null;
    recordedToDecodedSizeDifference: number | null;
    vaultSize: number | null;
    databaseToVaultSizeDifference: number | null;
    databaseMtime: number;
    vaultMtime: number | null;
    timestampDifferenceMs: number | null;
    timestampRelation: FileRepairTimestampRelation;
};

export function getFileRepairRevisionActions(
    inspection: FileRepairInspection,
    revision: FileRepairRevision
): FileRepairRevisionActions {
    const storageExists = inspection.information.storage.exists;
    const hasRevision = revision.metadata.revision !== null;
    const readableFileRevision =
        !revision.metadata.deleted &&
        revision.contentReadable &&
        revision.loadedEntry !== false;
    const matchesVault = storageExists && revision.contentMatchesStorage === true;
    const hasConflictBranches = inspection.information.database.conflictCount > 0;

    return {
        compareWithVault:
            readableFileRevision &&
            storageExists &&
            revision.contentMatchesStorage === false &&
            isPlainText(inspection.information.path),
        applyRevisionToVault:
            hasRevision &&
            readableFileRevision &&
            (!storageExists || revision.contentMatchesStorage !== true),
        markAsVaultRevision:
            hasRevision &&
            readableFileRevision &&
            matchesVault,
        storeVaultOnBranch:
            hasRevision &&
            storageExists &&
            revision.contentMatchesStorage !== true,
        applyLogicalDeletionToVault:
            hasRevision &&
            revision.metadata.deleted &&
            storageExists,
        retryRevision:
            hasRevision &&
            !revision.metadata.deleted &&
            !revision.contentReadable,
        discardBranch: hasRevision && hasConflictBranches,
        discardRevision:
            hasRevision &&
            !hasConflictBranches &&
            !revision.metadata.deleted &&
            !revision.contentReadable,
    };
}

export function getFileRepairRevisionComparison(
    inspection: FileRepairInspection,
    revision: FileRepairRevision
): FileRepairRevisionComparison {
    const decodedSize =
        revision.loadedEntry === false
            ? null
            : readAsBlob(revision.loadedEntry).size;
    const vaultSize =
        inspection.information.storage.exists
            ? (inspection.information.storage.size ?? null)
            : null;
    const databaseMtime = revision.metadata.mtime;
    const vaultMtime =
        inspection.information.storage.exists
            ? (inspection.information.storage.mtime ?? null)
            : null;
    const timestampDifferenceMs =
        databaseMtime > 0 && vaultMtime !== null && vaultMtime > 0
            ? vaultMtime - databaseMtime
            : null;
    let timestampRelation: FileRepairTimestampRelation = "unavailable";
    if (timestampDifferenceMs !== null) {
        const comparison = compareMTime(vaultMtime!, databaseMtime);
        timestampRelation =
            comparison === EVEN
                ? "same-window"
                : comparison === BASE_IS_NEW
                  ? "vault-newer"
                  : comparison === TARGET_IS_NEW
                    ? "database-newer"
                    : "unavailable";
    }

    return {
        recordedSize: revision.metadata.recordedSize,
        decodedSize,
        recordedToDecodedSizeDifference:
            decodedSize === null
                ? null
                : decodedSize - revision.metadata.recordedSize,
        vaultSize,
        databaseToVaultSizeDifference:
            decodedSize === null || vaultSize === null
                ? null
                : vaultSize - decodedSize,
        databaseMtime,
        vaultMtime,
        timestampDifferenceMs,
        timestampRelation,
    };
}
