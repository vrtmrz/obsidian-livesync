import type {
    FilePathIndex,
    FilePath,
    PathComparisonSettings,
    DirectoryEntry,
    StorageEntry,
} from "@vrtmrz/livesync-commonlib/storage";
import type { Stats } from "@vrtmrz/livesync-commonlib/node";
import type { ChokidarOptions, FSWatcher } from "chokidar";
import type { CliDiagnosticReporter } from "@/apps/cli/cliOutput";
import type { CLIPathFilterOptions } from "@/apps/cli/cliPathFilter";
import type { IgnoreRules } from "@/apps/cli/serviceModules/IgnoreRules";

/**
 * One physical listing under the owner's selected policy.
 *
 * Legacy entries retain raw names, including diagnosed exclusions needed for
 * later policy validation. NFC listings retain the resolver's branded physical
 * paths. The owner still checks generations before trusting the read's freshness.
 */
export type DirectoryListing =
    | { readonly kind: "legacy"; readonly entries: readonly DirectoryEntry[] }
    | { readonly kind: "validated"; readonly entries: readonly StorageEntry[] };

/**
 * Private contracts shared by the CLI name-source modules.
 *
 * Directory strings use original spellings relative to one storage root; the
 * empty string denotes that root. Validated entries retain physical names,
 * while invalidations may include requested scopes awaiting validation. The
 * source owns readiness and publication order.
 */
export type InventoryState = {
    /** Candidate buckets derived from the published original file names. */
    readonly index: FilePathIndex;
    /** Published membership used to discard repeated add/remove observations. */
    readonly files: Set<FilePath>;
    /** Last accepted immediate-child listing of each covered directory, including the root. */
    readonly directories: Map<string, readonly DirectoryEntry[]>;
    /** Failed scope reads retain earlier membership, which NFC queries must not trust. */
    readonly readErrors: Map<string, Error>;
    /** Identity-validation failures per directory under the selected policy. */
    aliasErrors: Map<string, Error>;
    /** Policy used to validate listings and retained identity failures. */
    policy: PathComparisonSettings;
};

/** A directory transition staged privately until every observed generation still matches. */
export type RefreshChanges = {
    /** Replacement listings and removed coverage, applied before membership changes. */
    readonly directoryUpdates: Map<string, readonly DirectoryEntry[]>;
    readonly removedDirectories: Set<string>;
    /** A path staged in both sets has unchanged membership when the transition commits. */
    readonly removedFiles: Set<FilePath>;
    readonly addedFiles: Set<FilePath>;
    /** New failures replace old diagnostics only when this transition can be published. */
    readonly readErrors: Map<string, Error>;
    readonly aliasErrors: Map<string, Error>;
    /** Scopes validated or removed by this transition, allowing old failures to clear. */
    readonly clearedErrors: Set<string>;
    /** Generations accepted for reads and retired scopes; a mismatch rejects the transition. */
    readonly checkedGenerations: Map<string, number>;
};

/** A failed fresh scan blocks reuse under the same policy until its scope is validated again. */
export type FreshValidationFailure = {
    readonly policy: PathComparisonSettings;
    readonly directory: string;
    readonly error: Error;
};

export type WatchEventType = "add" | "change" | "unlink" | "addDir" | "unlinkDir";

/** Eligible synchronisation notifications retained in arrival order before activation. */
export type QueuedWatchEvent = {
    readonly type: WatchEventType;
    readonly path: FilePath;
    readonly stats?: Stats;
};

/** Host-selected root, sync-only exclusions, diagnostics, and the watcher construction port. */
export type CLIFileNameSourceOptions = {
    readonly basePath: string;
    /** Filters sync delivery after inventory observation; it does not narrow name coverage. */
    readonly ignoreRules?: IgnoreRules;
    /** Shared target exclusions affect delivery only; ignored names remain collision candidates. */
    readonly pathFilterOptions?: CLIPathFilterOptions;
    readonly reportDiagnostic?: CliDiagnosticReporter;
    /** Capture operation-time suppression when observing, before startup buffering changes timing. */
    readonly suppressEvent?: (path: string) => boolean;
    /** Tests can control readiness and event order without installing another native watcher. */
    readonly watcherFactory?: (basePath: string, options: ChokidarOptions) => FSWatcher;
};

/** Storage reads and policy checks; callers decide when a candidate inventory can become ready. */
export interface InventoryReader {
    enumerate(policy: PathComparisonSettings, retainFailure?: boolean): Promise<InventoryState>;
    selectPolicy(state: InventoryState, policy: PathComparisonSettings): Promise<void>;
    readDirectory(directory: string, policy: PathComparisonSettings): Promise<DirectoryListing | null>;
}

/** Staged reconciliation uses the source's live generation maps but never owns its lifecycle. */
export interface InventoryReconciler {
    /** Reconcile captured scopes; return those invalidated again while being read. */
    reconcilePending(state: InventoryState, boundary: number, expandNewSubtrees?: boolean): Promise<Set<string>>;
    /** Follow physical parents under state.policy, already selected by the serialised owner. */
    revalidateTargetBranches(state: InventoryState, target: FilePath): Promise<Map<string, number>>;
    generationsUnchanged(generations: ReadonlyMap<string, number>): boolean;
}

/** Retain an existing error's identity and diagnostics when a host callback throws. */
export function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export function joinRelative(directory: string, leaf: string): string {
    return directory === "" ? leaf : directory + "/" + leaf;
}

export function childLeaf(parent: string, child: string): string {
    return parent === "" ? child : child.slice(parent.length + 1);
}

/** Derive cache names for future policy checks while the caller retains the typed listing. */
export function getRawDirectoryEntries(directory: string, listing: DirectoryListing): readonly DirectoryEntry[] {
    if (listing.kind === "legacy") {
        return listing.entries;
    }
    return listing.entries.map((entry) => ({ name: childLeaf(directory, entry.path), kind: entry.kind }));
}

export function parentPath(value: string): string {
    const separator = value.lastIndexOf("/");
    return separator < 0 ? "" : value.slice(0, separator);
}

export function depth(value: string): number {
    return value === "" ? 0 : value.split("/").length;
}

/** Compare identity policy values rather than callback/object identity. */
export function samePolicy(left: PathComparisonSettings, right: PathComparisonSettings): boolean {
    return (
        left.pathNormalizationVersion === right.pathNormalizationVersion &&
        left.handleFilenameCaseSensitive === right.handleFilenameCaseSensitive
    );
}

export function isSupportedPolicy(policy: PathComparisonSettings): boolean {
    return (
        (policy.pathNormalizationVersion === 0 || policy.pathNormalizationVersion === 1) &&
        typeof policy.handleFilenameCaseSensitive === "boolean"
    );
}
