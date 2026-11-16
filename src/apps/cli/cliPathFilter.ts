import { path } from "@vrtmrz/livesync-commonlib/node";
import { SuffixDatabaseName } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { parseFilePath, type FilePath } from "@vrtmrz/livesync-commonlib/storage";
import type { IgnoreRules } from "./serviceModules/IgnoreRules";

declare const vaultRelativePathBrand: unique symbol;

/**
 * A checked lexical path relative to the selected Vault. Filesystem existence,
 * descendant symlink targets, and the identity of the Vault require separate checks.
 */
export type VaultRelativePath = FilePath & {
    readonly [vaultRelativePathBrand]: true;
};

export interface CLIPathFilterOptions {
    /** Relax the naming heuristic while retaining storage protection and user exclusions. */
    readonly includeDbLikeDirs?: boolean;
    /** Configured DB root relative to the Vault: shared roots use ''; an outside root is undefined. */
    readonly databaseRoot?: VaultRelativePath;
}

export function isHiddenPath(relativePath: string): boolean {
    return relativePath.split("/").some((part) => part.startsWith("."));
}

/**
 * The sole constructor for watcher-relative paths. Rebase before filtering so
 * names above the selected Vault cannot exclude the entire watch root.
 */
export function toVaultRelativePath(vaultRoot: string, candidatePath: string): VaultRelativePath | undefined {
    // Relative inputs would make the result depend on the process working directory.
    if (!path.isAbsolute(vaultRoot) || !path.isAbsolute(candidatePath)) {
        return undefined;
    }

    const relativePath = path.relative(vaultRoot, candidatePath).replace(/\\/g, "/");
    try {
        // Preserve spelling and the empty root; reject outside/traversal and drive-qualified results.
        return parseFilePath(relativePath) as VaultRelativePath;
    } catch {
        return undefined;
    }
}

// PouchDB creates view indexes beside the primary DB using its name plus '-mrview-'.
// Both forms are conservative name matches, rather than proof of a directory's contents.
function isDbLikeDirectoryName(name: string): boolean {
    return name.endsWith(SuffixDatabaseName) || name.includes(`${SuffixDatabaseName}-mrview-`);
}

/** Protect current, previous, and view DB entries even when the naming heuristic is relaxed. */
function isDatabaseStoragePath(relativePath: FilePath, databaseRoot: VaultRelativePath | undefined): boolean {
    if (databaseRoot === undefined) {
        return false;
    }
    // Include the separator so a sibling such as 'state-copy' cannot enter the 'state' namespace.
    const prefix = databaseRoot === "" ? "" : `${databaseRoot}/`;
    if (!relativePath.startsWith(prefix)) {
        return false;
    }
    // Protect the direct DB entry and all descendants. Nested user-directory names
    // elsewhere still belong to the optional naming rule.
    const entry = relativePath.slice(prefix.length).split("/")[0];
    return isDbLikeDirectoryName(entry);
}

/** Shared exclusions for logical targets and watcher paths already rebased to the Vault. */
export function isIgnoredFilePath(
    relativePath: FilePath,
    rules?: Pick<IgnoreRules, "shouldIgnore">,
    options: CLIPathFilterOptions = {}
): boolean {
    // Keep the root traversable even when a user rule excludes every entry beneath it.
    if (relativePath === "") {
        return false;
    }

    // The opt-in bypasses only the naming heuristic; protected storage and explicit ignores still apply.
    return (
        isHiddenPath(relativePath) ||
        isDatabaseStoragePath(relativePath, options.databaseRoot) ||
        (!options.includeDbLikeDirs && relativePath.split("/").some(isDbLikeDirectoryName)) ||
        (rules?.shouldIgnore(relativePath) ?? false)
    );
}

/** Keep raw filesystem candidates out of the shared policy until conversion has validated them. */
export function isIgnoredVaultPath(
    relativePath: VaultRelativePath,
    rules?: Pick<IgnoreRules, "shouldIgnore">,
    options: CLIPathFilterOptions = {}
): boolean {
    return isIgnoredFilePath(relativePath, rules, options);
}
