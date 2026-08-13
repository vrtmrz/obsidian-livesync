import type { MetadataDocumentIdentityIssue } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/offlineScanner";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";
import type { FilePathWithPrefix } from "@vrtmrz/livesync-commonlib/compat/common/types";

export function metadataIdentityPathKey(path: string, handleFilenameCaseSensitive: boolean): string {
    const vaultPath = stripAllPrefixes(path as FilePathWithPrefix);
    return handleFilenameCaseSensitive ? vaultPath : vaultPath.toLowerCase();
}

/**
 * Select unresolved identity evidence for read-only presentation and create
 * the path keys which must be withheld from ordinary path-based repair.
 */
export function selectUnresolvedMetadataIdentityEntries(
    entries: readonly MetadataDocumentIdentityIssue[],
    handleFilenameCaseSensitive: boolean
): {
    entries: MetadataDocumentIdentityIssue[];
    unresolvedPathKeys: ReadonlySet<string>;
} {
    return {
        entries: [...entries],
        unresolvedPathKeys: new Set(
            entries
                .filter(({ ordinaryPathAvailable }) => !ordinaryPathAvailable)
                .map(({ inspection }) =>
                    metadataIdentityPathKey(inspection.diagnostic.declaredPath, handleFilenameCaseSensitive)
                )
        ),
    };
}
