import {
    createStoragePathResolver,
    FilePathIndex,
    getStoragePathComparisonKey,
    parseFilePath,
    type DirectoryEntry,
    type FilePath,
    type PathComparisonSettings,
    type StoragePath,
    type StorageEntry,
} from "@vrtmrz/livesync-commonlib/storage";
import type { UnicodeResolvingNodeStorageAdapter } from "@vrtmrz/livesync-commonlib/node";
import { isHiddenPath } from "@/apps/cli/cliPathFilter";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";
import {
    asError,
    getRawDirectoryEntries,
    isSupportedPolicy,
    joinRelative,
    samePolicy,
    type DirectoryListing,
    type InventoryReader,
    type InventoryState,
} from "./CLIFileNameSource.state";

export type InventoryReaderDependencies = {
    /** The read-only listing capability used to build and validate inventories. */
    readonly storage: Pick<UnicodeResolvingNodeStorageAdapter, "readDirectory">;
    readonly basePath: string;
    readonly reportDiagnostic: CliDiagnosticReporter;
    readonly markDirectoryDirty: (directory: string) => void;
    readonly recordFreshFailure: (state: InventoryState, policy: PathComparisonSettings, error: unknown) => void;
};

/**
 * Create an unpublished inventory candidate with an independent policy value.
 */
export function createEmptyState(policy: PathComparisonSettings): InventoryState {
    return {
        index: new FilePathIndex(),
        files: new Set<FilePath>(),
        directories: new Map<string, readonly DirectoryEntry[]>(),
        readErrors: new Map<string, Error>(),
        aliasErrors: new Map<string, Error>(),
        policy: { ...policy },
    };
}

/**
 * Bind the shared path resolver to the minimal storage read port used for sibling checks.
 */
export function createResolver(
    dependencies: Pick<InventoryReaderDependencies, "storage">,
    policy: PathComparisonSettings
) {
    return createStoragePathResolver({
        readDirectory: async (directory) => await dependencies.storage.readDirectory(directory),
        policy: {
            pathNormalizationVersion: 1,
            handleFilenameCaseSensitive: policy.handleFilenameCaseSensitive,
        },
    });
}

/**
 * Read original physical names in Legacy mode or resolver-validated names in NFC mode.
 */
export async function readDirectory(
    dependencies: Pick<InventoryReaderDependencies, "storage">,
    directory: string,
    policy: PathComparisonSettings
): Promise<DirectoryListing | null> {
    const physical = parseFilePath(directory) as StoragePath;
    // Legacy mode reads physical spellings directly. NFC mode also validates
    // sibling identities through the shared resolver before accepting coverage.
    if (policy.pathNormalizationVersion !== 1) {
        const entries = await dependencies.storage.readDirectory(physical);
        return entries === null ? null : { kind: "legacy", entries };
    }
    const entries = await createResolver(dependencies, policy).listResolvedDirectory(physical);
    if (entries === null) {
        return null;
    }
    // Keep the resolver's path refinements through membership publication.
    return { kind: "validated", entries };
}

/**
 * Parse supported Legacy entries lazily, preserving traversal and diagnostic order.
 *
 * Host enumeration supplies physical spelling; parsing checks the path syntax.
 * Invalid entries remain in raw coverage but never enter the file-name index.
 */
export function* parseLegacyStorageEntries(
    dependencies: Pick<InventoryReaderDependencies, "reportDiagnostic">,
    directory: string,
    entries: readonly DirectoryEntry[]
): Generator<StorageEntry, void> {
    for (const entry of entries) {
        const child = joinRelative(directory, entry.name);
        let childPath: StoragePath;
        try {
            childPath = parseFilePath(child) as StoragePath;
        } catch (error) {
            dependencies.reportDiagnostic("[CLIFileNameSource] Skipped invalid path '" + child + "':", error);
            continue;
        }
        yield { path: childPath, kind: entry.kind };
    }
}

/**
 * Add a complete directory subtree to an unpublished candidate, retaining Legacy partial reads.
 *
 * Storage supplies listings, basePath identifies an unavailable root, and diagnostics report
 * unreadable Legacy descendants or invalid physical names.
 */
export async function scanWholeDirectory(
    dependencies: Pick<InventoryReaderDependencies, "storage" | "basePath" | "reportDiagnostic">,
    state: InventoryState,
    directory: string,
    isRoot: boolean
): Promise<void> {
    // Direct subtree scans and recursive descent share the same admission rule.
    if (isHiddenPath(directory)) {
        return;
    }
    let listing: DirectoryListing | null;
    try {
        listing = await readDirectory(dependencies, directory, state.policy);
    } catch (error) {
        const failure = asError(error);
        // Legacy inventories retain partial readability; NFC inventories
        // must reject unreadable scopes so their identity checks stay sound.
        if (isRoot || state.policy.pathNormalizationVersion === 1) {
            if (failure.name === "AmbiguousNormalisedPathError") {
                state.aliasErrors.set(directory, failure);
            } else {
                state.readErrors.set(directory, failure);
            }
            throw failure;
        }
        state.readErrors.set(directory, failure);
        dependencies.reportDiagnostic("[CLIFileNameSource] Skipped unreadable directory '" + directory + "':", failure);
        return;
    }
    if (listing === null) {
        // An absent descendant contributes no names. An absent root means
        // there is no listing authority, so an empty inventory would be unsafe.
        if (isRoot) {
            throw new Error("The CLI file-name source root is unavailable: " + dependencies.basePath);
        }
        return;
    }

    state.directories.set(directory, getRawDirectoryEntries(directory, listing));
    state.readErrors.delete(directory);
    state.aliasErrors.delete(directory);
    const entries =
        listing.kind === "validated"
            ? listing.entries
            : parseLegacyStorageEntries(dependencies, directory, listing.entries);
    for (const entry of entries) {
        if (entry.kind === "file") {
            state.files.add(entry.path);
        } else if (!isHiddenPath(entry.path)) {
            // Supported listing excludes hidden subtrees, but includes hidden
            // leaf files encountered above for collision-name coverage.
            await scanWholeDirectory(dependencies, state, entry.path, false);
        }
    }
}

/**
 * Build a fresh candidate; the optional owner callback retains failures from requested fresh scans.
 */
export async function enumerate(
    dependencies: Pick<InventoryReaderDependencies, "storage" | "basePath" | "reportDiagnostic" | "recordFreshFailure">,
    policy: PathComparisonSettings,
    retainFailure = false
): Promise<InventoryState> {
    if (!isSupportedPolicy(policy)) {
        throw new Error("Unsupported path comparison policy: " + JSON.stringify(policy));
    }
    const state = createEmptyState(policy);
    try {
        await scanWholeDirectory(dependencies, state, "", true);
        state.index.replaceAll(state.files);
        return state;
    } catch (error) {
        if (retainFailure) {
            // The owner records the first failing scope and keeps this
            // failed fresh scan from being mistaken for an empty inventory.
            dependencies.recordFreshFailure(state, policy, error);
        }
        throw error;
    }
}

/**
 * Validate cached sibling identities before publishing a policy, then dirty failed scopes for NFC rereads.
 *
 * This operation uses cached original names only; it performs no storage I/O.
 */
export async function selectPolicy(
    dependencies: Pick<InventoryReaderDependencies, "markDirectoryDirty">,
    state: InventoryState,
    policy: PathComparisonSettings
): Promise<void> {
    if (!isSupportedPolicy(policy)) {
        throw new Error("Unsupported path comparison policy: " + JSON.stringify(policy));
    }
    if (samePolicy(state.policy, policy)) {
        return;
    }

    // Alias evidence belongs to the policy, whereas cached entries preserve
    // physical names. Recheck all covered siblings before publishing the policy.
    const nextAliasErrors = new Map<string, Error>();
    if (policy.pathNormalizationVersion === 1) {
        for (const [directory, entries] of state.directories) {
            const seen = new Map<string, string>();
            for (const entry of entries) {
                let key: string;
                try {
                    key = getStoragePathComparisonKey(parseFilePath(entry.name), policy);
                } catch (error) {
                    nextAliasErrors.set(directory, asError(error));
                    break;
                }
                // Different physical siblings sharing this key make the NFC
                // directory ambiguous; choosing either would hide a candidate.
                const previous = seen.get(key);
                if (previous !== undefined) {
                    nextAliasErrors.set(
                        directory,
                        new Error(
                            "Ambiguous NFC entries under '" +
                                directory +
                                "': '" +
                                previous +
                                "' and '" +
                                entry.name +
                                "'"
                        )
                    );
                    break;
                }
                seen.set(key, entry.name);
            }
        }
    }

    // Rebuild alias evidence from the cached physical spellings before
    // publishing the new policy; failed directories are then revalidated.
    state.policy = { ...policy };
    state.aliasErrors = nextAliasErrors;
    if (policy.pathNormalizationVersion === 1) {
        for (const directory of state.readErrors.keys()) {
            dependencies.markDirectoryDirty(directory);
        }
    }
}

/**
 * Bind the inventory operations to CLIFileNameSource dependencies without owning readiness or failure state.
 */
export function createInventoryReader(dependencies: InventoryReaderDependencies): InventoryReader {
    const enumerationDependencies = {
        storage: dependencies.storage,
        basePath: dependencies.basePath,
        reportDiagnostic: dependencies.reportDiagnostic,
        recordFreshFailure: dependencies.recordFreshFailure,
    };
    const directoryDependencies = { storage: dependencies.storage };
    const policyDependencies = { markDirectoryDirty: dependencies.markDirectoryDirty };

    return {
        enumerate: (policy, retainFailure) => enumerate(enumerationDependencies, policy, retainFailure),
        selectPolicy: (state, policy) => selectPolicy(policyDependencies, state, policy),
        readDirectory: (directory, policy) => readDirectory(directoryDependencies, directory, policy),
    };
}
