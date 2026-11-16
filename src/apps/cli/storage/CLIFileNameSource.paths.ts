import {
    getStoragePathComparisonKey,
    parseFilePath,
    type DirectoryEntry,
    type FilePath,
    type PathComparisonSettings,
} from "@vrtmrz/livesync-commonlib/storage";
import { isHiddenPath } from "@/apps/cli/cliPathFilter";
import { joinRelative } from "./CLIFileNameSource.state";

/** Select supported physical child directories while retaining raw entries elsewhere for NFC validation. */
export function getSupportedChildDirectories(parent: string, entries: readonly DirectoryEntry[]): FilePath[] {
    const directories: FilePath[] = [];
    for (const entry of entries) {
        if (entry.kind !== "directory") {
            continue;
        }
        const child = joinRelative(parent, entry.name);
        if (isHiddenPath(child)) {
            continue;
        }
        try {
            directories.push(parseFilePath(child));
        } catch {
            // Legacy enumeration excludes these names. Their raw coverage must
            // still participate when the owner later selects an NFC policy.
        }
    }
    return directories;
}

/**
 * Locate physical scopes for an invalidation using retained directory entries only.
 *
 * A missing or uncovered component selects its nearest known ancestor, whose
 * next read can discover new subtrees. NFC mutations may explicitly override
 * case handling, so invalidate every possible case-equivalent branch. Legacy
 * scopes use the effective host case policy, including insensitive storage. This is an invalidation hint,
 * not path resolution or permission to perform filesystem I/O.
 */
export function findInvalidatedDirectoryScopes(
    directories: ReadonlyMap<string, readonly DirectoryEntry[]>,
    requested: string,
    policy: PathComparisonSettings
): Set<string> {
    const scopes = new Set<string>();
    if (isHiddenPath(requested)) {
        return scopes;
    }
    const comparisonPolicy = {
        ...policy,
        handleFilenameCaseSensitive: policy.pathNormalizationVersion === 0 && policy.handleFilenameCaseSensitive,
    };
    let branches = new Set([""]);
    for (const segment of requested === "" ? [] : requested.split("/")) {
        const nextBranches = new Set<string>();
        for (const parent of branches) {
            const entries = directories.get(parent) ?? [];
            const key = getStoragePathComparisonKey(parseFilePath(joinRelative(parent, segment)), comparisonPolicy);
            const matches = getSupportedChildDirectories(parent, entries).filter(
                (child) => getStoragePathComparisonKey(child, comparisonPolicy) === key
            );
            if (matches.length === 0) {
                scopes.add(parent);
            } else {
                for (const child of matches) {
                    nextBranches.add(child);
                }
            }
        }
        branches = nextBranches;
    }
    for (const directory of branches) {
        scopes.add(directory);
    }
    return scopes;
}
