import { describe, expect, it } from "vitest";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { FileRepairInspection, FileRepairRevision } from "./fileRepair";
import {
    getFileRepairRevisionActions,
    getFileRepairRevisionComparison,
} from "./fileRepairPresentation";

function createInspection(
    revision: Partial<FileRepairRevision> = {},
    storage: { exists: boolean; size?: number; mtime?: number } = {
        exists: true,
        size: 12,
        mtime: 5_500,
    }
): { inspection: FileRepairInspection; revision: FileRepairRevision } {
    const completeRevision = {
        role: "conflict",
        metadata: {
            documentId: "f:note",
            revision: "2-conflict",
            current: false,
            deleted: false,
            storageType: "plain",
            storageLayout: "chunked",
            ctime: 1,
            mtime: 2_000,
            recordedSize: 9,
            revisionHistory: [],
            chunkReferences: 0,
            uniqueChunkReferences: 0,
            embeddedChunkReferences: 0,
            locallyStoredChunkReferences: 0,
            contentAvailableLocally: true,
            chunks: [],
        },
        contentReadable: true,
        contentMatchesStorage: false,
        loadedEntry: {
            _id: "f:note",
            _rev: "2-conflict",
            path: "note.md",
            ctime: 1,
            mtime: 2_000,
            size: 9,
            type: "plain",
            datatype: "plain",
            children: [],
            eden: {},
            data: "content",
        },
        ...revision,
    } as FileRepairRevision;
    const inspection = {
        information: {
            path: "note.md",
            databasePath: "note.md" as FilePathWithPrefix,
            storage,
            database: {
                source: "local database on this device",
                remoteQueried: false,
                exists: true,
                currentRevision: "3-winner",
                conflictCount: 1,
                conflictRevisions: ["2-conflict"],
                unavailableConflictRevisions: [],
                revisions: [],
                mergeBases: [],
            },
        },
        revisions: [completeRevision],
        requiresAttention: true,
    } satisfies FileRepairInspection;
    return { inspection, revision: completeRevision };
}

describe("file repair presentation", () => {
    it("offers both reconciliation directions for a readable differing revision", () => {
        const { inspection, revision } = createInspection();

        expect(getFileRepairRevisionActions(inspection, revision)).toEqual({
            compareWithVault: true,
            applyRevisionToVault: true,
            markAsVaultRevision: false,
            storeVaultOnBranch: true,
            applyLogicalDeletionToVault: false,
            retryRevision: false,
            discardRevision: false,
            discardBranch: true,
        });
    });

    it("marks an exact matching revision without creating another child", () => {
        const { inspection, revision } = createInspection({
            contentMatchesStorage: true,
        });

        expect(getFileRepairRevisionActions(inspection, revision)).toMatchObject({
            compareWithVault: false,
            applyRevisionToVault: false,
            markAsVaultRevision: true,
            storeVaultOnBranch: false,
            discardBranch: true,
        });
    });

    it("does not offer a text comparison for a binary file", () => {
        const { inspection, revision } = createInspection();
        inspection.information.path = "image.png";

        expect(getFileRepairRevisionActions(inspection, revision)).toMatchObject({
            compareWithVault: false,
            applyRevisionToVault: true,
            storeVaultOnBranch: true,
        });
    });

    it("offers explicit deletion or branch extension for a logical deletion", () => {
        const { inspection, revision } = createInspection({
            metadata: {
                ...createInspection().revision.metadata,
                deleted: true,
            },
            contentReadable: true,
            contentMatchesStorage: null,
            loadedEntry: false,
        });

        expect(getFileRepairRevisionActions(inspection, revision)).toMatchObject({
            applyRevisionToVault: false,
            storeVaultOnBranch: true,
            applyLogicalDeletionToVault: true,
            retryRevision: false,
            discardRevision: false,
            discardBranch: true,
        });
    });

    it("offers retry, discard, and branch extension for an unreadable live revision", () => {
        const { inspection, revision } = createInspection({
            contentReadable: false,
            contentMatchesStorage: null,
            loadedEntry: false,
        });

        expect(getFileRepairRevisionActions(inspection, revision)).toMatchObject({
            compareWithVault: false,
            applyRevisionToVault: false,
            markAsVaultRevision: false,
            storeVaultOnBranch: true,
            retryRevision: true,
            discardRevision: false,
            discardBranch: true,
        });
    });

    it("keeps the existing unreadable-leaf escape hatch when there is no conflict branch", () => {
        const { inspection, revision } = createInspection({
            role: "winner",
            contentReadable: false,
            contentMatchesStorage: null,
            loadedEntry: false,
        });
        inspection.information.database.conflictCount = 0;
        inspection.information.database.conflictRevisions = [];
        inspection.information.database.currentRevision = revision.metadata.revision;

        expect(getFileRepairRevisionActions(inspection, revision)).toMatchObject({
            discardRevision: true,
            discardBranch: false,
        });
    });

    it("does not offer a storage action for a matching absent logical deletion", () => {
        const { inspection, revision } = createInspection(
            {
                metadata: {
                    ...createInspection().revision.metadata,
                    deleted: true,
                },
                contentReadable: true,
                contentMatchesStorage: null,
                loadedEntry: false,
            },
            { exists: false }
        );

        expect(getFileRepairRevisionActions(inspection, revision)).toMatchObject({
            applyLogicalDeletionToVault: false,
            storeVaultOnBranch: false,
        });
    });

    it("reports recorded, decoded, Vault-size, and timestamp differences", () => {
        const { inspection, revision } = createInspection();

        expect(getFileRepairRevisionComparison(inspection, revision)).toEqual({
            recordedSize: 9,
            decodedSize: 7,
            recordedToDecodedSizeDifference: -2,
            vaultSize: 12,
            databaseToVaultSizeDifference: 5,
            databaseMtime: 2_000,
            vaultMtime: 5_500,
            timestampDifferenceMs: 3_500,
            timestampRelation: "vault-newer",
        });
    });

    it("uses the same two-second timestamp comparison window as synchronisation", () => {
        const { inspection, revision } = createInspection(
            {
                metadata: {
                    ...createInspection().revision.metadata,
                    mtime: 3_001,
                },
            },
            {
                exists: true,
                size: 12,
                mtime: 3_999,
            }
        );

        expect(getFileRepairRevisionComparison(inspection, revision)).toMatchObject({
            timestampDifferenceMs: 998,
            timestampRelation: "same-window",
        });
    });
});
