import {
    MODE_AUTOMATIC,
    MODE_PAUSED,
    MODE_SELECTIVE,
    type FilePathWithPrefix,
    type ObsidianLiveSyncSettings,
    type SYNC_MODE,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { stripAllPrefixes } from "@vrtmrz/livesync-commonlib/compat/string_and_binary/path";

export type CustomisationCategory = "CONFIG" | "THEME" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_ETC" | "PLUGIN_DATA";

export type OptionalFileSyncOwner = "config" | "hidden" | "ignored";

export const PLUGIN_MAIN_FILES = ["manifest.json", "main.js", "styles.css"] as const;
export const THEME_FILES = ["manifest.json", "theme.css"] as const;

const CUSTOMISATION_CATEGORIES = new Set<string>([
    "CONFIG",
    "THEME",
    "SNIPPET",
    "PLUGIN_MAIN",
    "PLUGIN_ETC",
    "PLUGIN_DATA",
]);

export interface CustomisationFileClassification {
    category: CustomisationCategory;
    key: string;
    relativePath: string;
}

export interface CustomisationClassificationOptions {
    configDir: string;
    useV2: boolean;
    usePluginEtc: boolean;
    includePluginEtc?: boolean;
    insensitive?: boolean;
}

export interface CustomisationOwnershipOptions {
    configDir: string;
    settings: Pick<
        ObsidianLiveSyncSettings,
        "usePluginSync" | "usePluginSyncV2" | "usePluginEtc" | "pluginSyncExtendedSetting"
    >;
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

export function findCustomisationEntryKey(
    key: string,
    entries: CustomisationEntries | undefined,
    insensitive = false
): string | undefined {
    if (!entries) return undefined;
    if (entries[key] !== undefined) return key;
    if (!insensitive) return undefined;
    const lowered = key.toLowerCase();
    return Object.keys(entries).find(
        (entryKey) => entryKey.toLowerCase() === lowered || entries[entryKey].key.toLowerCase() === lowered
    );
}

export function findCustomisationEntryMode(
    key: string,
    entries: CustomisationEntries | undefined,
    insensitive = false
): SYNC_MODE | undefined {
    const savedKey = findCustomisationEntryKey(key, entries, insensitive);
    return savedKey === undefined ? undefined : entries?.[savedKey]?.mode;
}

export function updateCustomisationEntryMode(
    entries: CustomisationEntries,
    key: string,
    mode: SYNC_MODE,
    files: string[],
    insensitive: boolean
): void {
    const savedKey = findCustomisationEntryKey(key, entries, insensitive) ?? key;
    if (mode === MODE_SELECTIVE) {
        delete entries[savedKey];
        return;
    }
    entries[savedKey] = { key: entries[savedKey]?.key ?? key, mode, files };
}

export function isCustomisationItemExcludedFromConfigSync(
    key: string,
    entries: ObsidianLiveSyncSettings["pluginSyncExtendedSetting"] | undefined,
    insensitive = false
): boolean {
    const mode = findCustomisationEntryMode(key, entries, insensitive);
    return mode === MODE_PAUSED || mode === MODE_AUTOMATIC;
}

export function extractCustomisationItemKeyFromUnifiedPath(unifiedPath: FilePathWithPrefix): string | undefined {
    const stripped = stripAllPrefixes(unifiedPath);
    const [, category, ...rest] = stripped.split("/");
    if (!category || !CUSTOMISATION_CATEGORIES.has(category) || rest.length === 0) {
        return undefined;
    }
    const relativePath = rest.join("/");
    const percentIndex = relativePath.indexOf("%");
    const isV2Format =
        percentIndex !== -1 &&
        (!relativePath.endsWith(".md") ||
            ((category === "THEME" || category === "PLUGIN_ETC") && relativePath.slice(percentIndex + 1) !== ".md"));
    if (isV2Format) {
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

export function isCaseInsensitiveSelection(
    settings: Pick<Partial<ObsidianLiveSyncSettings>, "handleFilenameCaseSensitive"> | undefined,
    vault?: { isStorageInsensitive?: () => boolean }
): boolean {
    return !settings?.handleFilenameCaseSensitive || (vault?.isStorageInsensitive?.() ?? false);
}

export function getHiddenFileSyncPatternExcludedFiles(
    files: readonly string[],
    isTargetFileInPatterns: (path: string) => boolean
): string[] {
    return files.filter((file) => !isTargetFileInPatterns(file));
}
