import {
    getStoragePathComparisonKey,
    parseFilePath,
    type DirectoryEntry,
    type FilePath,
    type PathComparisonSettings,
} from "@vrtmrz/livesync-commonlib/storage";
import { isHiddenPath } from "@/apps/cli/cliPathFilter";
import { findInvalidatedDirectoryScopes, getSupportedChildDirectories } from "./CLIFileNameSource.paths";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";
import {
    asError,
    depth,
    joinRelative,
    getRawDirectoryEntries,
    type DirectoryListing,
    type InventoryReader,
    type InventoryReconciler,
    type InventoryState,
    type RefreshChanges,
} from "./CLIFileNameSource.state";

/**
 * Full owner ports for target validation and factory composition. Target reads
 * also commit coverage under the source-selected policy, using every port.
 */
export type InventoryReconcilerDependencies = {
    readonly reader: Pick<InventoryReader, "readDirectory">;
    readonly basePath: string;
    readonly reportDiagnostic: CliDiagnosticReporter;
    /** Source-owned pending scopes, keyed by their first unhandled observation sequence. */
    readonly invalidatedDirectories: Map<string, number>;
    /** Latest source observation sequence per scope, used to reject superseded reads. */
    readonly directoryGenerations: Map<string, number>;
    readonly getBoundary: () => number;
    readonly markDirectoryDirty: (directory: string) => void;
    readonly assertNotClosed: () => void;
    readonly assertInventoryAvailable: (state: InventoryState, policy: PathComparisonSettings) => void;
    readonly onValidatedDirectories: (policy: PathComparisonSettings, directories: ReadonlySet<string>) => void;
};

/** Ports used while reading and staging one directory; publication is separate. */
export type RefreshDirectoryDependencies = Pick<
    InventoryReconcilerDependencies,
    "basePath" | "reportDiagnostic" | "directoryGenerations" | "markDirectoryDirty" | "getBoundary"
> & {
    readonly reader: Pick<InventoryReader, "readDirectory">;
};

/** Mutable owner bookkeeping touched only when a validated transition commits. */
export type CommitRefreshDependencies = Pick<
    InventoryReconcilerDependencies,
    "assertNotClosed" | "onValidatedDirectories" | "invalidatedDirectories" | "directoryGenerations"
>;

/** Captured-scope reconciliation reads and conditionally commits the same transition. */
export type ReconcilePendingDependencies = RefreshDirectoryDependencies & CommitRefreshDependencies;

/** Invalid Legacy leaf names need diagnostics; membership itself is explicit input. */
export type StageFileMembershipChangesDependencies = Pick<InventoryReconcilerDependencies, "reportDiagnostic">;

/** Create an unpublished transition which can be discarded after a superseded read. */
export function createRefreshChanges(): RefreshChanges {
    return {
        directoryUpdates: new Map<string, readonly DirectoryEntry[]>(),
        removedDirectories: new Set<string>(),
        removedFiles: new Set<FilePath>(),
        addedFiles: new Set<FilePath>(),
        readErrors: new Map<string, Error>(),
        aliasErrors: new Map<string, Error>(),
        clearedErrors: new Set<string>(),
        checkedGenerations: new Map<string, number>(),
    };
}

/** Read this transition's staged view first, then the last published listing. */
export function currentEntries(
    state: InventoryState,
    directory: string,
    changes: RefreshChanges
): readonly DirectoryEntry[] {
    if (changes.removedDirectories.has(directory)) {
        return [];
    }
    return changes.directoryUpdates.get(directory) ?? state.directories.get(directory) ?? [];
}

/** A staged removal overrides older coverage when deciding whether a child needs population. */
export function hasDirectoryCoverage(state: InventoryState, directory: string, changes: RefreshChanges): boolean {
    return (
        !changes.removedDirectories.has(directory) &&
        (changes.directoryUpdates.has(directory) || state.directories.has(directory))
    );
}

/** Retire cached descendants without I/O; publication still waits for generation checks. */
export function stageRemoveSubtree(
    state: InventoryState,
    directory: string,
    changes: RefreshChanges,
    visited: Set<string>
): void {
    if (visited.has(directory)) {
        return;
    }
    visited.add(directory);
    const entries = currentEntries(state, directory, changes);
    for (const entry of entries) {
        const child = joinRelative(directory, entry.name);
        if (entry.kind === "file") {
            try {
                changes.removedFiles.add(parseFilePath(child));
            } catch {
                // Invalid legacy names were never indexed.
            }
        } else if (!entry.name.startsWith(".")) {
            stageRemoveSubtree(state, child, changes, visited);
        }
    }
    changes.directoryUpdates.delete(directory);
    changes.removedDirectories.add(directory);
    changes.clearedErrors.add(directory);
    changes.readErrors.delete(directory);
    changes.aliasErrors.delete(directory);
}

/**
 * Fence retired descendants against observations newer than the parent read.
 *
 * Generations are latest observation sequences. Only removed subtrees need this
 * check; unchanged descendants require no traversal or generation snapshot.
 */
export function fenceRemovedDirectories(
    directoryGenerations: ReadonlyMap<string, number>,
    changes: RefreshChanges,
    readBoundary: number
): void {
    for (const directory of changes.removedDirectories) {
        if (changes.checkedGenerations.has(directory)) {
            continue;
        }
        const generation = directoryGenerations.get(directory) ?? 0;
        // A newer descendant cannot be retired using its parent's older listing.
        // The existing publication check rejects this sentinel and retains work.
        changes.checkedGenerations.set(directory, generation > readBoundary ? -1 : generation);
    }
}

/**
 * Publish a transition after its caller has checked the captured generations.
 *
 * The owner must still be open. Only invalidations within this read boundary can
 * clear; newer notifications retain their generation and pending work.
 */
export function commitRefresh(
    dependencies: CommitRefreshDependencies,
    state: InventoryState,
    changes: RefreshChanges,
    boundary: number
): void {
    dependencies.assertNotClosed();
    for (const directory of changes.removedDirectories) {
        state.directories.delete(directory);
        state.readErrors.delete(directory);
        state.aliasErrors.delete(directory);
    }
    for (const [directory, entries] of changes.directoryUpdates) {
        state.directories.set(directory, entries);
    }
    for (const directory of changes.clearedErrors) {
        state.readErrors.delete(directory);
        state.aliasErrors.delete(directory);
    }
    // Clear owner-held failure evidence only after the validated scopes
    // have replaced old errors, and before this transition adds new errors.
    dependencies.onValidatedDirectories(state.policy, changes.clearedErrors);
    for (const [directory, error] of changes.readErrors) {
        state.readErrors.set(directory, error);
        state.aliasErrors.delete(directory);
    }
    for (const [directory, error] of changes.aliasErrors) {
        state.aliasErrors.set(directory, error);
    }

    // A path removed and recreated within this transition keeps its identity
    // membership. Only actual set changes need to update the shared buckets.
    const removed = Array.from(changes.removedFiles).filter(
        (file) => !changes.addedFiles.has(file) && state.files.has(file)
    );
    const added = Array.from(changes.addedFiles).filter(
        (file) => !changes.removedFiles.has(file) && !state.files.has(file)
    );
    for (const file of removed) {
        state.files.delete(file);
    }
    for (const file of added) {
        state.files.add(file);
    }
    if (removed.length > 0 || added.length > 0) {
        state.index.apply({ removed, added });
    }

    // Acknowledge only observations covered by this read and its caller's
    // boundary. This acknowledgement fence preserves later notifications even
    // after the caller has checked the transition's publication generations.
    for (const [directory, generation] of changes.checkedGenerations) {
        if ((dependencies.directoryGenerations.get(directory) ?? 0) !== generation) {
            continue;
        }
        const firstSequence = dependencies.invalidatedDirectories.get(directory);
        if (firstSequence !== undefined && firstSequence <= boundary) {
            dependencies.invalidatedDirectories.delete(directory);
        }
        if (changes.removedDirectories.has(directory) && (firstSequence === undefined || firstSequence <= boundary)) {
            dependencies.directoryGenerations.delete(directory);
        }
    }
    // Removing a parent also retires cached descendant generations. Keep a
    // descendant's newer invalidation if it arrived after the captured boundary.
    for (const directory of changes.removedDirectories) {
        const checkedGeneration = changes.checkedGenerations.get(directory);
        if (
            checkedGeneration !== undefined &&
            (dependencies.directoryGenerations.get(directory) ?? 0) !== checkedGeneration
        ) {
            continue;
        }
        const firstSequence = dependencies.invalidatedDirectories.get(directory);
        if (firstSequence === undefined || firstSequence <= boundary) {
            dependencies.invalidatedDirectories.delete(directory);
            dependencies.directoryGenerations.delete(directory);
        }
    }
}

/** Compare captured reads with live counters; an unobserved scope starts at generation zero. */
export function generationsUnchanged(
    directoryGenerations: ReadonlyMap<string, number>,
    generations: ReadonlyMap<string, number>
): boolean {
    for (const [directory, generation] of generations) {
        if ((directoryGenerations.get(directory) ?? 0) !== generation) {
            return false;
        }
    }
    return true;
}

/**
 * Stage exact-name deltas, retaining validated paths and prior Legacy exclusions.
 *
 * Only newly added raw Legacy names need parsing and diagnostics. Old invalid
 * names may remain in coverage after a policy change but were never indexed.
 */
export function stageFileMembershipChanges(
    dependencies: StageFileMembershipChangesDependencies,
    directory: string,
    previous: readonly DirectoryEntry[],
    listing: DirectoryListing,
    changes: RefreshChanges
): void {
    const previousFiles = new Set(
        previous.filter((entry) => entry.kind === "file").map((entry) => joinRelative(directory, entry.name))
    );
    const currentFiles = new Set<string>(
        listing.kind === "validated"
            ? listing.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)
            : listing.entries
                  .filter((entry) => entry.kind === "file")
                  .map((entry) => joinRelative(directory, entry.name))
    );
    for (const file of previousFiles) {
        if (!currentFiles.has(file)) {
            try {
                changes.removedFiles.add(parseFilePath(file));
            } catch {
                // Prior Legacy coverage can contain invalid names which were never indexed.
            }
        }
    }
    if (listing.kind === "validated") {
        // NFC resolution already checked these paths. Keep their original brand
        // instead of rebuilding and parsing strings from cached leaf names.
        for (const entry of listing.entries) {
            if (entry.kind === "file" && !previousFiles.has(entry.path)) {
                changes.addedFiles.add(entry.path);
            }
        }
        return;
    }
    for (const file of currentFiles) {
        if (!previousFiles.has(file)) {
            try {
                changes.addedFiles.add(parseFilePath(file));
            } catch (error) {
                dependencies.reportDiagnostic("[CLIFileNameSource] Skipped invalid path '" + file + "':", error);
            }
        }
    }
}

/**
 * Stage one scope: validate a listing, diff its files, then reconcile its children.
 *
 * Failed reads retain previous membership and stage an error. Missing descendants
 * retire cached subtrees; a missing root is unavailable coverage. Target-only
 * queries defer newly discovered subtrees, while full reconciliation expands them.
 * The caller publishes this transition only if all captured generations still match.
 */
export async function refreshDirectory(
    dependencies: RefreshDirectoryDependencies,
    state: InventoryState,
    directory: string,
    changes: RefreshChanges,
    expandNewSubtrees: boolean,
    visiting: Set<string>
): Promise<void> {
    // Avoid re-entering a scope already on the recursion stack. Capture its
    // generation before I/O so a later observation can reject stale work.
    if (visiting.has(directory)) {
        return;
    }
    visiting.add(directory);
    const readBoundary = dependencies.getBoundary();
    changes.checkedGenerations.set(directory, dependencies.directoryGenerations.get(directory) ?? 0);
    // Direct dirty scopes obey the same listing boundary as recursive scans.
    // Retire any old coverage without reading an excluded hidden subtree.
    if (isHiddenPath(directory)) {
        stageRemoveSubtree(state, directory, changes, new Set<string>());
        fenceRemovedDirectories(dependencies.directoryGenerations, changes, readBoundary);
        visiting.delete(directory);
        return;
    }

    // Validate current immediate children without changing the published view.
    let listing: DirectoryListing | null;
    try {
        listing = await dependencies.reader.readDirectory(directory, state.policy);
    } catch (error) {
        const failure = asError(error);
        // Identity ambiguity and unreadable coverage are retained separately:
        // policy changes can re-evaluate aliases without erasing failed I/O.
        if (failure.name === "AmbiguousNormalisedPathError") {
            changes.aliasErrors.set(directory, failure);
        } else {
            changes.readErrors.set(directory, failure);
        }
        // Retain failed coverage for the owner to reject when required by the
        // selected policy. Initial full enumeration has its own strict reader.
        dependencies.reportDiagnostic("[CLIFileNameSource] Could not validate directory '" + directory + "':", failure);
        visiting.delete(directory);
        return;
    }

    if (listing === null) {
        // Disappearance is a removal only below the root. Losing the root
        // cannot turn a formerly populated Vault into a validated empty one.
        if (directory === "") {
            const failure = new Error("The CLI file-name source root is unavailable: " + dependencies.basePath);
            changes.readErrors.set(directory, failure);
            visiting.delete(directory);
            return;
        }
        stageRemoveSubtree(state, directory, changes, new Set<string>());
        changes.clearedErrors.add(directory);
        fenceRemovedDirectories(dependencies.directoryGenerations, changes, readBoundary);
        visiting.delete(directory);
        return;
    }

    // This scope validated successfully; stage its listing and clear only
    // its old failures. File membership changes preserve original spellings.
    const entries = getRawDirectoryEntries(directory, listing);
    const previous = currentEntries(state, directory, changes);
    changes.directoryUpdates.set(directory, entries);
    changes.clearedErrors.add(directory);
    changes.aliasErrors.delete(directory);
    changes.readErrors.delete(directory);

    stageFileMembershipChanges(dependencies, directory, previous, listing, changes);

    // Retire vanished children before considering new or uncovered subtrees.
    const previousDirectories = new Set(getSupportedChildDirectories(directory, previous));
    const currentDirectories = new Set(getSupportedChildDirectories(directory, entries));
    for (const child of previousDirectories) {
        if (!currentDirectories.has(child)) {
            stageRemoveSubtree(state, child, changes, new Set<string>());
        }
    }
    for (const child of currentDirectories) {
        // Existing covered children are handled by their own invalidations.
        // A new/uncovered child needs population, but target-only queries leave
        // that recursive work pending instead of scanning unrelated descendants.
        if (!previousDirectories.has(child) || !hasDirectoryCoverage(state, child, changes)) {
            if (expandNewSubtrees) {
                await refreshDirectory(dependencies, state, child, changes, true, visiting);
            } else {
                dependencies.markDirectoryDirty(child);
            }
        }
    }
    fenceRemovedDirectories(dependencies.directoryGenerations, changes, readBoundary);
    visiting.delete(directory);
}

/** Reconcile the captured scopes once, retaining those superseded during their reads. */
export async function reconcilePending(
    dependencies: ReconcilePendingDependencies,
    state: InventoryState,
    boundary: number,
    expandNewSubtrees = true
): Promise<Set<string>> {
    const unresolved = new Set<string>();
    // Parents can remove or repopulate descendants, so process shallower
    // scopes first and skip descendants already settled by those transitions.
    const scopes = Array.from(dependencies.invalidatedDirectories.entries())
        .filter(([, firstSequence]) => firstSequence <= boundary)
        .map(([directory]) => directory)
        .sort((left, right) => depth(left) - depth(right));
    for (const directory of scopes) {
        if (!dependencies.invalidatedDirectories.has(directory)) {
            continue;
        }
        const changes = createRefreshChanges();
        const readBoundary = dependencies.getBoundary();
        // Startup mutations can arrive before physical coverage is published.
        // Resolve their requested scopes against this candidate too, retaining
        // the original generation until every corresponding physical read commits.
        changes.checkedGenerations.set(directory, dependencies.directoryGenerations.get(directory) ?? 0);
        const physicalScopes = findInvalidatedDirectoryScopes(state.directories, directory, state.policy);
        for (const physicalDirectory of physicalScopes) {
            await refreshDirectory(
                dependencies,
                state,
                physicalDirectory,
                changes,
                expandNewSubtrees,
                new Set<string>()
            );
        }
        if (!physicalScopes.has(directory)) {
            // A logical alias or excluded scope owns no physical coverage. Its
            // pending generation must not accumulate after acknowledgement.
            stageRemoveSubtree(state, directory, changes, new Set<string>());
        }
        fenceRemovedDirectories(dependencies.directoryGenerations, changes, readBoundary);
        // An observed change during any staged read invalidates the whole
        // transition; retain its scopes for a later query or requested pass.
        if (!generationsUnchanged(dependencies.directoryGenerations, changes.checkedGenerations)) {
            unresolved.add(directory);
            continue;
        }
        commitRefresh(dependencies, state, changes, boundary);
    }
    return unresolved;
}

/** Validate each equivalent physical parent without recursively expanding unrelated new subtrees. */
export async function revalidateTargetBranches(
    dependencies: InventoryReconcilerDependencies,
    state: InventoryState,
    target: FilePath
): Promise<Map<string, number>> {
    // The source selected this policy before entering its serialised operation.
    const policy = state.policy;
    const segments = String(target).split("/");
    const parentSegments = segments.slice(0, -1);
    let branches = [""];
    const generations = new Map<string, number>();

    // Follow every supported physical branch matching each logical parent segment.
    // Hidden subtrees stay outside the enumerator's scope; a query must not admit
    // their descendants into the shared inventory. Keep all supported case variants.
    for (const segment of parentSegments) {
        const nextBranches = new Set<string>();
        for (const parent of branches) {
            const generation = await refreshSingleDirectory(dependencies, state, parent);
            generations.set(parent, generation);
            const entries = state.directories.get(parent) ?? [];
            const key = getStoragePathComparisonKey(parseFilePath(joinRelative(parent, segment)), policy);
            for (const child of getSupportedChildDirectories(parent, entries)) {
                if (getStoragePathComparisonKey(child, policy) === key) {
                    nextBranches.add(child);
                }
            }
        }
        branches = Array.from(nextBranches);
        if (branches.length === 0) {
            break;
        }
    }

    for (const parent of branches) {
        const generation = await refreshSingleDirectory(dependencies, state, parent);
        generations.set(parent, generation);
    }
    dependencies.assertInventoryAvailable(state, policy);
    return generations;
}

/**
 * Validate and publish one branch, recording a direct failure before rejecting it.
 * The owner has selected state.policy before entering this operation. A
 * superseded read returns a non-matching generation so the target query retries.
 */
export async function refreshSingleDirectory(
    dependencies: InventoryReconcilerDependencies,
    state: InventoryState,
    directory: string
): Promise<number> {
    const changes = createRefreshChanges();
    await refreshDirectory(dependencies, state, directory, changes, false, new Set<string>());
    if (!generationsUnchanged(dependencies.directoryGenerations, changes.checkedGenerations)) {
        // Generations are non-negative. This sentinel makes the caller retry
        // rather than accept a branch whose validation was superseded.
        return -1;
    }
    const directError = changes.aliasErrors.get(directory) ?? changes.readErrors.get(directory);
    commitRefresh(dependencies, state, changes, dependencies.getBoundary());
    if (directError) {
        throw directError;
    }
    dependencies.assertInventoryAvailable(state, state.policy);
    return dependencies.directoryGenerations.get(directory) ?? 0;
}

/**
 * Bind the owner ports to the standalone operations without hiding their logic.
 *
 * Inventory state and staged changes remain explicit inputs. No mutable state is
 * created here, so direct operation tests can supply only the ports they exercise.
 */
export function createInventoryReconciler(dependencies: InventoryReconcilerDependencies): InventoryReconciler {
    return {
        reconcilePending: (state, boundary, expandNewSubtrees) =>
            reconcilePending(dependencies, state, boundary, expandNewSubtrees),
        revalidateTargetBranches: (state, target) => revalidateTargetBranches(dependencies, state, target),
        generationsUnchanged: (generations) => generationsUnchanged(dependencies.directoryGenerations, generations),
    };
}
