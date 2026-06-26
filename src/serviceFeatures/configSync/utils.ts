import { parseYaml } from "@/deps.ts";
import { digestHash } from "@lib/string_and_binary/hash.ts";
import { stripAllPrefixes } from "@lib/string_and_binary/path.ts";
import { ICXHeader } from "@/common/types.ts";
import type { FilePathWithPrefix } from "@lib/common/types.ts";
import type { PluginDataEx, PluginDataExFile } from "./types.ts";

/**
 * A zero-width space character used as a field delimiter in the custom serialisation format.
 */
export const d = "\u200b";

/**
 * A newline character used as a record delimiter in the custom serialisation format.
 */
export const d2 = "\n";

/**
 * Serialises a plugin data structure into a custom compact string format.
 *
 * @param data - The plugin data to serialise.
 * @returns The serialised compact string.
 */
export function serialize(data: PluginDataEx): string {
    let ret = "";
    ret += ":";
    ret += data.category + d + data.name + d + data.term + d2;
    ret += (data.version ?? "") + d2;
    ret += data.mtime + d2;
    for (const file of data.files) {
        ret += file.filename + d + (file.displayName ?? "") + d + (file.version ?? "") + d2;
        const hash = digestHash(file.data ?? []);
        ret += file.mtime + d + file.size + d + hash + d2;
        for (const piece of file.data ?? []) {
            ret += piece + d;
        }
        ret += d2;
    }
    return ret;
}

/**
 * A placeholder header string used to represent the start of the serialised configuration chunk stream.
 */
export const DUMMY_HEAD = serialize({
    category: "CONFIG",
    name: "migrated",
    files: [],
    mtime: 0,
    term: "-",
    displayName: "MIRAGED",
});

/**
 * A placeholder footer string used to represent the end of the serialised configuration chunk stream.
 */
export const DUMMY_END = d + d2 + "\u200c";

/**
 * Splits source strings by compact format delimiters.
 *
 * @param sources - The source strings to split.
 * @returns Split string array.
 */
export function splitWithDelimiters(sources: string[]): string[] {
    const result: string[] = [];
    for (const str of sources) {
        let startIndex = 0;
        const maxLen = str.length;
        let i = -1;
        let i1;
        let i2;
        do {
            i1 = str.indexOf(d, startIndex);
            i2 = str.indexOf(d2, startIndex);
            if (i1 == -1 && i2 == -1) {
                break;
            }
            if (i1 == -1) {
                i = i2;
            } else if (i2 == -1) {
                i = i1;
            } else {
                i = i1 < i2 ? i1 : i2;
            }
            result.push(str.slice(startIndex, i + 1));
            startIndex = i + 1;
        } while (i < maxLen);
        if (startIndex < maxLen) {
            result.push(str.slice(startIndex));
        }
    }

    if (sources[sources.length - 1] == "") {
        result.push("");
    }

    return result;
}

/**
 * Creates a tokenizer helper for deserialisation parsing.
 *
 * @param source - Split string token sources.
 * @returns Tokenizer helper object.
 */
export function getTokenizer(source: string[]) {
    const sources = splitWithDelimiters(source);
    sources[0] = sources[0].substring(1);
    let pos = 0;
    let lineRunOut = false;
    const t = {
        next(): string {
            if (lineRunOut) {
                return "";
            }
            if (pos >= sources.length) {
                return "";
            }
            const item = sources[pos];
            if (!item.endsWith(d2)) {
                pos++;
            } else {
                lineRunOut = true;
            }
            if (item.endsWith(d) || item.endsWith(d2)) {
                return item.substring(0, item.length - 1);
            } else {
                return item + this.next();
            }
        },
        nextLine() {
            if (lineRunOut) {
                pos++;
            } else {
                while (!sources[pos].endsWith(d2)) {
                    pos++;
                    if (pos >= sources.length) break;
                }
                pos++;
            }
            lineRunOut = false;
        },
    };
    return t;
}

/**
 * Deserialises tokenised array lines into a plugin data structure.
 *
 * @param str - The array lines to deserialise.
 * @returns Deserialised plugin data.
 */
export function deserialize2(str: string[]): PluginDataEx {
    const tokens = getTokenizer(str);
    const ret = {} as PluginDataEx;
    const category = tokens.next();
    const name = tokens.next();
    const term = tokens.next();
    tokens.nextLine();
    const version = tokens.next();
    tokens.nextLine();
    const mtime = Number(tokens.next());
    tokens.nextLine();
    const result: PluginDataEx = Object.assign(ret, {
        category,
        name,
        term,
        version,
        mtime,
        files: [] as PluginDataExFile[],
    });
    let filename = "";
    do {
        filename = tokens.next();
        if (!filename) break;
        const displayName = tokens.next();
        const version = tokens.next();
        tokens.nextLine();
        const mtime = Number(tokens.next());
        const size = Number(tokens.next());
        const hash = tokens.next();
        tokens.nextLine();
        const data = [] as string[];
        let piece = "";
        do {
            piece = tokens.next();
            if (piece == "") break;
            data.push(piece);
        } while (piece != "");
        result.files.push({
            filename,
            displayName,
            version,
            mtime,
            size,
            data,
            hash,
        });
        tokens.nextLine();
    } while (filename);
    return result;
}

/**
 * Deserialises file content string arrays into a target object representation.
 * Supports compact prefix format, JSON parsing, and YAML fallback.
 *
 * @param str - Content string lines.
 * @param def - Fallback default value.
 * @returns Deserialised object structure.
 */
export function deserialize<T>(str: string[], def: T) {
    try {
        if (str[0][0] == ":") {
            const o = deserialize2(str);
            return o;
        }
        return JSON.parse(str.join("")) as T;
    } catch {
        try {
            return parseYaml(str.join(""));
        } catch {
            return def;
        }
    }
}

/**
 * Maps a configuration category and base path to a vault relative subdirectory.
 *
 * @param category - Configuration category.
 * @param configDir - The main system configuration directory path.
 * @returns Vault folder suffix path.
 */
export function categoryToFolder(category: string, configDir: string = ""): string {
    switch (category) {
        case "CONFIG":
            return `${configDir}/`;
        case "THEME":
            return `${configDir}/themes/`;
        case "SNIPPET":
            return `${configDir}/snippets/`;
        case "PLUGIN_MAIN":
            return `${configDir}/plugins/`;
        case "PLUGIN_DATA":
            return `${configDir}/plugins/`;
        case "PLUGIN_ETC":
            return `${configDir}/plugins/`;
        default:
            return "";
    }
}

/**
 * Resolves local file category based on the system configuration directory.
 *
 * @param filePath - Local file path.
 * @param configDir - Vault system config folder name.
 * @param useV2 - Whether V2 plugin structure is active.
 * @param useSyncPluginEtc - Whether custom subfolders under plugins are synchronised.
 * @returns Category identifier.
 */
export function getFileCategory(
    filePath: string,
    configDir: string,
    useV2: boolean,
    useSyncPluginEtc: boolean
): "CONFIG" | "THEME" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_ETC" | "PLUGIN_DATA" | "" {
    if (filePath.split("/").length == 2 && filePath.endsWith(".json")) return "CONFIG";
    if (filePath.split("/").length == 4 && filePath.startsWith(`${configDir}/themes/`)) return "THEME";
    if (filePath.startsWith(`${configDir}/snippets/`) && filePath.endsWith(".css")) return "SNIPPET";
    if (filePath.startsWith(`${configDir}/plugins/`)) {
        if (filePath.endsWith("/styles.css") || filePath.endsWith("/manifest.json") || filePath.endsWith("/main.js")) {
            return "PLUGIN_MAIN";
        } else if (filePath.endsWith("/data.json")) {
            return "PLUGIN_DATA";
        } else {
            return useV2 && useSyncPluginEtc ? "PLUGIN_ETC" : "";
        }
    }
    return "";
}

/**
 * Checks if the file path is a valid customization sync path candidate.
 *
 * @param filePath - Target file path.
 * @param configDir - Vault configuration folder path.
 * @param useV2 - Whether V2 sync is enabled.
 * @param useSyncPluginEtc - Whether config files sync is enabled.
 * @returns True if path is a sync target.
 */
export function isTargetPath(filePath: string, configDir: string, useV2: boolean, useSyncPluginEtc: boolean): boolean {
    if (!filePath.startsWith(configDir)) return false;
    return getFileCategory(filePath, configDir, useV2, useSyncPluginEtc) != "";
}

/**
 * Converts local path into unified database document path.
 *
 * @param path - Local file path.
 * @param term - Active device name.
 * @param configDir - Vault config directory name.
 * @param useV2 - Whether V2 is active.
 * @param useSyncPluginEtc - Whether sync plugin etc is active.
 * @returns The database path identifier.
 */
export function filenameToUnifiedKey(
    path: string,
    term: string,
    configDir: string,
    useV2: boolean,
    useSyncPluginEtc: boolean
): FilePathWithPrefix {
    const category = getFileCategory(path, configDir, useV2, useSyncPluginEtc);
    const name =
        category == "CONFIG" || category == "SNIPPET"
            ? path.split("/").slice(-1)[0]
            : category == "PLUGIN_ETC"
              ? path.split("/").slice(-2).join("/")
              : path.split("/").slice(-2)[0];
    return `${ICXHeader}${term}/${category}/${name}.md` as FilePathWithPrefix;
}

/**
 * Converts local path into V2 unified database document path.
 *
 * @param path - Local file path.
 * @param term - Active device name.
 * @param configDir - Vault config directory name.
 * @param useV2 - Whether V2 is active.
 * @param useSyncPluginEtc - Whether sync plugin etc is active.
 * @returns The database path identifier.
 */
export function filenameWithUnifiedKey(
    path: string,
    term: string,
    configDir: string,
    useV2: boolean,
    useSyncPluginEtc: boolean
): FilePathWithPrefix {
    const category = getFileCategory(path, configDir, useV2, useSyncPluginEtc);
    const name =
        category == "CONFIG" || category == "SNIPPET" ? path.split("/").slice(-1)[0] : path.split("/").slice(-2)[0];
    const baseName = category == "CONFIG" || category == "SNIPPET" ? name : path.split("/").slice(3).join("/");
    return `${ICXHeader}${term}/${category}/${name}%${baseName}` as FilePathWithPrefix;
}

/**
 * Returns database prefix path filter for a terminal configuration.
 *
 * @param term - Active device name.
 * @returns Database path prefix string.
 */
export function unifiedKeyPrefixOfTerminal(term: string): FilePathWithPrefix {
    return `${ICXHeader}${term}/` as FilePathWithPrefix;
}

/**
 * Parses a V2 unified database path into its constituent components.
 *
 * @param unifiedPath - Unified path metadata document identifier.
 * @returns Parsed components.
 */
export function parseUnifiedPath(unifiedPath: FilePathWithPrefix): {
    category: string;
    device: string;
    key: string;
    filename: string;
    pathV1: FilePathWithPrefix;
} {
    const [device, category, ...rest] = stripAllPrefixes(unifiedPath).split("/");
    const relativePath = rest.join("/");
    const [key, filename] = relativePath.split("%");
    const pathV1 = (unifiedPath.split("%")[0] + ".md") as FilePathWithPrefix;
    return { device, category, key, filename, pathV1 };
}
