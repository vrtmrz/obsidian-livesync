import {
    MODE_AUTOMATIC,
    MODE_PAUSED,
    MODE_SELECTIVE,
    MODE_SHINY,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
    type SYNC_MODE,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

/** Customisation Sync item category used as the prefix of saved `pluginSyncExtendedSetting` keys. */
export type CustomisationCategory = "CONFIG" | "THEME" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_ETC" | "PLUGIN_DATA";

/** Feature responsible for a Vault path when Customisation Sync and Hidden File Sync interact. */
export type OptionalFileSyncOwner = "config" | "hidden" | "ignored";

/** Fixed files bundled into a V1 `PLUGIN_MAIN` binder. */
export const PLUGIN_MAIN_FILES = ["manifest.json", "main.js", "styles.css"] as const;
/** Fixed files bundled into a V1 `THEME` binder. */
export const THEME_FILES = ["manifest.json", "theme.css"] as const;

const CUSTOMISATION_CATEGORIES = new Set<string>([
    "CONFIG",
    "THEME",
    "SNIPPET",
    "PLUGIN_MAIN",
    "PLUGIN_ETC",
    "PLUGIN_DATA",
]);

/** Result of mapping a Vault path under the configuration directory to its Customisation Sync item. */
export interface CustomisationFileClassification {
    /** Customisation Sync category that owns this file shape. */
    category: CustomisationCategory;
    /** Saved-setting key in `<CATEGORY>/<itemName>` form (for example, `SNIPPET/example.css`). */
    key: string;
    /** Path relative to the Vault's configuration directory, without a leading slash. */
    relativePath: string;
}

/** Options controlling whether a Vault path is classified as a Customisation Sync file. */
export interface CustomisationClassificationOptions {
    /** Vault configuration directory (for example, `.obsidian` or a nested custom config path). */
    configDir: string;
    /** Whether Customisation Sync V2 is enabled; V1 restricts themes to `THEME_FILES`. */
    useV2: boolean;
    /** Whether extra plug-in files (`PLUGIN_ETC`) are enabled in settings. */
    usePluginEtc: boolean;
    /** Optional override for `PLUGIN_ETC` inclusion (defaults to `useV2 && usePluginEtc`). */
    includePluginEtc?: boolean;
    /** Whether directory, category, and filename matching should be case-insensitive. */
    insensitive?: boolean;
}

/** Options used to resolve which optional sync feature owns a Vault path. */
export interface CustomisationOwnershipOptions {
    /** Vault configuration directory (for example, `.obsidian`). */
    configDir: string;
    /** Current plug-in sync settings governing ownership and saved item modes. */
    settings: Pick<
        ObsidianLiveSyncSettings,
        "usePluginSync" | "usePluginSyncV2" | "usePluginEtc" | "pluginSyncExtendedSetting"
    >;
    /** Whether path and saved-key comparisons should be case-insensitive. */
    insensitive?: boolean;
}

function normaliseConfigDir(configDir: string): string {
    return configDir.replace(/\/+$/, "");
}

function normaliseSegment(segment: string, insensitive: boolean): string {
    return insensitive ? segment.toLowerCase() : segment;
}

function isFixedV1Member(files: readonly string[], filename: string, insensitive: boolean): boolean {
    return files.includes(normaliseSegment(filename, insensitive));
}

/** Maps a Customisation Sync category name to its folder prefix under `configDir`. */
export function categoryToFolder(category: string, configDir: string = ""): string {
    switch (category) {
        case "CONFIG":
            return `${configDir}/`;
        case "THEME":
            return `${configDir}/themes/`;
        case "SNIPPET":
            return `${configDir}/snippets/`;
        case "PLUGIN_MAIN":
        case "PLUGIN_DATA":
        case "PLUGIN_ETC":
            return `${configDir}/plugins/`;
        default:
            return "";
    }
}

/**
 * Returns the file path relative to `configDir`, enforcing a directory boundary so sibling paths
 * (such as `.obsidian-extra/...`) do not match `.obsidian`, and rejecting directory paths.
 */
export function pathWithinConfigDirectory(path: string, configDir: string, insensitive = false): string | undefined {
    const dir = normaliseConfigDir(configDir);
    if (!dir) return undefined;
    const prefix = `${dir}/`;
    const matched = insensitive
        ? path.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
        : path.startsWith(prefix);
    if (!matched) return undefined;
    const relative = path.slice(prefix.length);
    if (!relative || relative.endsWith("/")) return undefined;
    return relative;
}

/**
 * Classifies a Vault path into its Customisation Sync category and item key, or `undefined` when
 * the path is outside Customisation Sync's scope and remains eligible for Hidden File Sync.
 */
export function classifyCustomisationFile(
    filePath: string,
    options: CustomisationClassificationOptions
): CustomisationFileClassification | undefined {
    const insensitive = options.insensitive ?? false;
    const relativePath = pathWithinConfigDirectory(filePath, options.configDir, insensitive);
    if (!relativePath) return undefined;

    const parts = relativePath.split("/");

    if (parts.length === 1) {
        const [filename] = parts;
        if (normaliseSegment(filename, insensitive).endsWith(".json")) {
            return { category: "CONFIG", key: `CONFIG/${filename}`, relativePath };
        }
        return undefined;
    }

    const folder = normaliseSegment(parts[0], insensitive);

    // Restrict snippets to direct `<configDir>/snippets/*.css` files; Obsidian loads only top-level CSS
    // snippets, and nested files remain with Hidden File Sync to avoid V2 key collisions and wrong-path restores.
    if (folder === "snippets" && parts.length === 2) {
        const [, filename] = parts;
        if (normaliseSegment(filename, insensitive).endsWith(".css")) {
            return { category: "SNIPPET", key: `SNIPPET/${filename}`, relativePath };
        }
        return undefined;
    }

    if (folder === "themes" && parts.length === 3) {
        const [, themeName, filename] = parts;
        if (options.useV2 || isFixedV1Member(THEME_FILES, filename, insensitive)) {
            return { category: "THEME", key: `THEME/${themeName}`, relativePath };
        }
        return undefined;
    }

    if (folder === "plugins" && parts.length === 3) {
        const [, pluginName, filename] = parts;
        if (isFixedV1Member(PLUGIN_MAIN_FILES, filename, insensitive)) {
            return { category: "PLUGIN_MAIN", key: `PLUGIN_MAIN/${pluginName}`, relativePath };
        }
        if (normaliseSegment(filename, insensitive) === "data.json") {
            return { category: "PLUGIN_DATA", key: `PLUGIN_DATA/${pluginName}`, relativePath };
        }
        const includePluginEtc = options.includePluginEtc ?? (options.useV2 && options.usePluginEtc);
        if (includePluginEtc) {
            return { category: "PLUGIN_ETC", key: `PLUGIN_ETC/${pluginName}`, relativePath };
        }
        return undefined;
    }

    return undefined;
}

type CustomisationEntries = ObsidianLiveSyncSettings["pluginSyncExtendedSetting"];

const PLUGIN_SETTING_PREFIXES = new Set(["PLUGIN_ALL", "PLUGIN_MAIN", "PLUGIN_DATA", "PLUGIN_ETC"]);

// Protective precedence for pre-existing case-equivalent duplicates before the next edit reconciles them:
// Ignore > Flagged Selective > Selective > Automatic.
const CONFLICTING_MODE_PRECEDENCE: Record<number, number> = {
    [MODE_PAUSED]: 0,
    [MODE_SHINY]: 1,
    [MODE_SELECTIVE]: 2,
    [MODE_AUTOMATIC]: 3,
};

/**
 * Finds all saved keys in `pluginSyncExtendedSetting` matching `key`, ordered deterministically by
 * protective mode precedence (and then key spelling) so reads do not depend on caller casing.
 */
export function findMatchingCustomisationEntryKeys(
    key: string,
    entries: CustomisationEntries | undefined,
    insensitive = false
): string[] {
    if (!entries) {
        return [];
    }
    if (!insensitive) {
        return entries[key] !== undefined ? [key] : [];
    }
    const lowered = key.toLowerCase();
    const matched = Object.keys(entries).filter(
        (entryKey) => entryKey.toLowerCase() === lowered || entries[entryKey].key.toLowerCase() === lowered
    );
    return matched.sort((left, right) => {
        const leftRank = CONFLICTING_MODE_PRECEDENCE[entries[left].mode] ?? 99;
        const rightRank = CONFLICTING_MODE_PRECEDENCE[entries[right].mode] ?? 99;
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }
        return left < right ? -1 : left > right ? 1 : 0;
    });
}

/** Returns the winning saved key for `key` under the active case-sensitivity policy, if any. */
export function findCustomisationEntryKey(
    key: string,
    entries: CustomisationEntries | undefined,
    insensitive = false
): string | undefined {
    return findMatchingCustomisationEntryKeys(key, entries, insensitive)[0];
}

/** Returns the effective saved `SYNC_MODE` for `key`, or `undefined` when unconfigured (default Selective). */
export function findCustomisationEntryMode(
    key: string,
    entries: CustomisationEntries | undefined,
    insensitive = false
): SYNC_MODE | undefined {
    const savedKey = findCustomisationEntryKey(key, entries, insensitive);
    return savedKey === undefined ? undefined : entries?.[savedKey]?.mode;
}

/**
 * Updates `pluginSyncExtendedSetting` for `key`, reconciling any case-equivalent duplicate keys.
 * Setting `MODE_SELECTIVE` deletes matching entries (returning to the unconfigured default), whilst
 * non-empty saved `files` are preserved when `files` is empty for an item absent from the catalogue.
 */
export function updateCustomisationEntryMode(
    entries: CustomisationEntries,
    key: string,
    mode: SYNC_MODE,
    files: string[],
    insensitive: boolean
): void {
    const matchedKeys = findMatchingCustomisationEntryKeys(key, entries, insensitive);
    if (mode === MODE_SELECTIVE) {
        for (const matchedKey of matchedKeys) {
            delete entries[matchedKey];
        }
        return;
    }
    const savedKey = matchedKeys.includes(key) ? key : (matchedKeys[0] ?? key);
    const existingFiles = [...new Set(matchedKeys.flatMap((matchedKey) => entries[matchedKey]?.files ?? []))];
    for (const duplicateKey of matchedKeys) {
        if (duplicateKey !== savedKey) {
            delete entries[duplicateKey];
        }
    }
    // Retain existing recorded filenames when the item is not currently listed in the catalogue.
    const nextFiles = files.length > 0 ? files : existingFiles;
    entries[savedKey] = { key: entries[savedKey]?.key ?? key, mode, files: nextFiles };
}

/**
 * Returns plug-in names present in saved `pluginSyncExtendedSetting` entries but absent from
 * `existingNames`. V2 catalogue scans skip excluded V1 binders (`Ignore` or `Automatic`), so these
 * names keep saved-only plug-in rows visible in the UI and recoverable by the user.
 */
export function collectSavedCustomisationPluginNames(
    existingNames: readonly string[],
    entries: CustomisationEntries | undefined,
    insensitive = false
): string[] {
    if (!entries) return [];
    const normalise = (value: string) => (insensitive ? value.toLowerCase() : value);
    const seen = new Set(existingNames.map(normalise));
    const savedOnly: string[] = [];
    for (const entryKey of Object.keys(entries)) {
        const canonicalKey = entries[entryKey]?.key || entryKey;
        const slashIndex = canonicalKey.indexOf("/");
        if (slashIndex === -1) continue;
        const prefix = canonicalKey.slice(0, slashIndex);
        if (!PLUGIN_SETTING_PREFIXES.has(prefix)) continue;
        const name = canonicalKey.slice(slashIndex + 1).split("/")[0];
        if (!name) continue;
        const identity = normalise(name);
        if (seen.has(identity)) continue;
        seen.add(identity);
        savedOnly.push(name);
    }
    return savedOnly;
}

/** Reports whether Customisation Sync must skip `key` because it is set to `Ignore` or `Automatic`. */
export function isCustomisationItemExcludedFromConfigSync(
    key: string,
    entries: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] | undefined,
    insensitive = false
): boolean {
    const mode = findCustomisationEntryMode(key, entries, insensitive);
    return mode === MODE_PAUSED || mode === MODE_AUTOMATIC;
}

/**
 * Extracts `<CATEGORY>/<itemName>` from an `ix:` database path or case-folded document ID for both
 * V1 binders (`.../<name>.md`) and V2 per-file records (`.../<name>%<relativeFile>`).
 */
export function extractCustomisationItemKeyFromUnifiedPath(unifiedPath: FilePathWithPrefix): string | undefined {
    const stripped = stripAllPrefixes(unifiedPath);
    const [, rawCategory, ...rest] = stripped.split("/");
    // Normalise category casing because V2 scans can pass PouchDB's case-folded `_id` (`ix:device/config/...`).
    const category = rawCategory?.toUpperCase();
    if (!category || !CUSTOMISATION_CATEGORIES.has(category) || rest.length === 0) {
        return undefined;
    }
    const relativePath = rest.join("/");
    const percentIndex = relativePath.indexOf("%");
    // V1 binders end in `.md`, whereas V2 `THEME` and `PLUGIN_ETC` records may legitimately contain `.md` members after `%`.
    const isV2Format =
        percentIndex !== -1 &&
        (!relativePath.endsWith(".md") ||
            ((category === "THEME" || category === "PLUGIN_ETC") && relativePath.slice(percentIndex + 1) !== ".md"));
    if (isV2Format) {
        // V2 `CONFIG` and `SNIPPET` paths repeat the filename on both sides of `%` (`a.json%a.json`).
        if (category === "CONFIG" || category === "SNIPPET") {
            const midpoint = Math.floor(relativePath.length / 2);
            if (relativePath.length % 2 === 1 && relativePath[midpoint] === "%") {
                const left = relativePath.slice(0, midpoint);
                if (left && left === relativePath.slice(midpoint + 1)) {
                    return `${category}/${left}`;
                }
            }
        }
        const itemName = relativePath.slice(0, percentIndex);
        return itemName ? `${category}/${itemName}` : undefined;
    }
    const withoutExtension = relativePath.endsWith(".md") ? relativePath.slice(0, -3) : relativePath;
    const itemName = category === "PLUGIN_ETC" ? withoutExtension.split("/")[0] : withoutExtension;
    return itemName ? `${category}/${itemName}` : undefined;
}

/**
 * Resolves which feature owns `filePath`:
 * - `"hidden"` when Customisation Sync is disabled, the path is outside its scope, or the item is `Automatic`.
 * - `"ignored"` when the item is `Ignore` (`MODE_PAUSED`), excluding it from both features.
 * - `"config"` for `Selective` (including unconfigured default items) and `Flagged Selective`.
 */
export function selectCustomisationOwner(
    filePath: string,
    options: CustomisationOwnershipOptions
): OptionalFileSyncOwner {
    if (!options.settings.usePluginSync) {
        return "hidden";
    }
    const insensitive = options.insensitive ?? false;
    const classification = classifyCustomisationFile(filePath, {
        configDir: options.configDir,
        useV2: options.settings.usePluginSyncV2 ?? false,
        usePluginEtc: options.settings.usePluginEtc ?? false,
        insensitive,
    });
    if (!classification) {
        return "hidden";
    }
    const mode = findCustomisationEntryMode(
        classification.key,
        options.settings.pluginSyncExtendedSetting,
        insensitive
    );
    if (mode === MODE_PAUSED) {
        return "ignored";
    }
    if (mode === MODE_AUTOMATIC) {
        return "hidden";
    }
    return "config";
}

/** Returns whether optional-file selection should match paths and saved keys case-insensitively. */
export function isCaseInsensitiveSelection(
    settings: Pick<Partial<ObsidianLiveSyncSettings>, "handleFilenameCaseSensitive"> | undefined,
    vault?: { isStorageInsensitive?: () => boolean }
): boolean {
    return !settings?.handleFilenameCaseSensitive || (vault?.isStorageInsensitive?.() ?? false);
}

/** Filters `files` to those excluded by Hidden File Sync's target or ignore regular-expression patterns. */
export function getHiddenFileSyncPatternExcludedFiles(
    files: readonly string[],
    isTargetFileInPatterns: (path: string) => boolean
): string[] {
    return files.filter((file) => !isTargetFileInPatterns(file));
}
