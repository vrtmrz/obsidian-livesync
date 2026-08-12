import { describe, expect, it } from "vitest";
import type { MetadataDocumentIdentityIssue } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { metadataIdentityPathKey, selectUnresolvedMetadataIdentityEntries } from "./metadataIdentityInspection";

function createEntries(): MetadataDocumentIdentityIssue[] {
    return [
        {
            inspection: {
                status: "unresolved",
                diagnostic: {
                    reason: "document-id-mismatch",
                    actualDocumentId: "f:stale",
                    declaredPath: "Folder/Renamed.md",
                    expectedDocumentId: "f:renamed",
                    actualNamespace: "normal",
                    declaredPathNamespace: "normal",
                },
            },
            sourceRevision: "3-stale",
            logicallyDeleted: false,
            conflictRevisions: [],
            repairAvailable: false,
            targetAlreadyPresent: false,
            ordinaryPathAvailable: false,
        },
        {
            inspection: {
                status: "unresolved",
                diagnostic: {
                    reason: "namespace-mismatch",
                    actualDocumentId: "f:stale-internal-path",
                    declaredPath: "i:.Obsidian/App.json",
                    actualNamespace: "normal",
                    declaredPathNamespace: "internal",
                },
            },
            sourceRevision: "2-stale",
            logicallyDeleted: false,
            conflictRevisions: [],
            repairAvailable: false,
            targetAlreadyPresent: false,
            ordinaryPathAvailable: false,
        },
    ] as unknown as MetadataDocumentIdentityIssue[];
}

describe("Metadata identity inspection presentation", () => {
    it("derives case-insensitive Vault path keys for unresolved evidence", () => {
        const result = selectUnresolvedMetadataIdentityEntries(createEntries(), false);

        expect(result.entries.map(({ sourceRevision }) => sourceRevision)).toEqual(["3-stale", "2-stale"]);
        expect([...result.unresolvedPathKeys]).toEqual(["folder/renamed.md", ".obsidian/app.json"]);
        expect(metadataIdentityPathKey("folder/RENAMED.md", false)).toBe("folder/renamed.md");
        expect(result.unresolvedPathKeys.has(metadataIdentityPathKey("folder/RENAMED.md", false))).toBe(true);
    });

    it("retains case distinctions when filename handling is case-sensitive", () => {
        const result = selectUnresolvedMetadataIdentityEntries(createEntries(), true);

        expect(result.unresolvedPathKeys.has("Folder/Renamed.md")).toBe(true);
        expect(result.unresolvedPathKeys.has("folder/renamed.md")).toBe(false);
    });

    it("does not suppress ordinary inspection when the path has resolvable Metadata", () => {
        const entries = createEntries();
        entries[0] = {
            ...entries[0],
            ordinaryPathAvailable: true,
        } as MetadataDocumentIdentityIssue;

        const result = selectUnresolvedMetadataIdentityEntries(entries, false);

        expect(result.entries).toHaveLength(2);
        expect(result.unresolvedPathKeys.has("folder/renamed.md")).toBe(false);
        expect(result.unresolvedPathKeys.has(".obsidian/app.json")).toBe(true);
    });
});
