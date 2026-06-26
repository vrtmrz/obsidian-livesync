// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { FilePathWithPrefix } from "@lib/common/types.ts";
import type { PluginDataEx } from "./types.ts";
/**
 * A zero-width space character used as a field delimiter in the custom serialisation format.
 */
export declare const d = "\u200B";
/**
 * A newline character used as a record delimiter in the custom serialisation format.
 */
export declare const d2 = "\n";
/**
 * Serialises a plugin data structure into a custom compact string format.
 *
 * @param data - The plugin data to serialise.
 * @returns The serialised compact string.
 */
export declare function serialize(data: PluginDataEx): string;
/**
 * A placeholder header string used to represent the start of the serialised configuration chunk stream.
 */
export declare const DUMMY_HEAD: string;
/**
 * A placeholder footer string used to represent the end of the serialised configuration chunk stream.
 */
export declare const DUMMY_END: string;
/**
 * Splits source strings by compact format delimiters.
 *
 * @param sources - The source strings to split.
 * @returns Split string array.
 */
export declare function splitWithDelimiters(sources: string[]): string[];
/**
 * Creates a tokenizer helper for deserialisation parsing.
 *
 * @param source - Split string token sources.
 * @returns Tokenizer helper object.
 */
export declare function getTokenizer(source: string[]): {
    next(): string;
    nextLine(): void;
};
/**
 * Deserialises tokenised array lines into a plugin data structure.
 *
 * @param str - The array lines to deserialise.
 * @returns Deserialised plugin data.
 */
export declare function deserialize2(str: string[]): PluginDataEx;
/**
 * Deserialises file content string arrays into a target object representation.
 * Supports compact prefix format, JSON parsing, and YAML fallback.
 *
 * @param str - Content string lines.
 * @param def - Fallback default value.
 * @returns Deserialised object structure.
 */
export declare function deserialize<T>(str: string[], def: T): any; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Maps a configuration category and base path to a vault relative subdirectory.
 *
 * @param category - Configuration category.
 * @param configDir - The main system configuration directory path.
 * @returns Vault folder suffix path.
 */
export declare function categoryToFolder(category: string, configDir?: string): string;
/**
 * Resolves local file category based on the system configuration directory.
 *
 * @param filePath - Local file path.
 * @param configDir - Vault system config folder name.
 * @param useV2 - Whether V2 plugin structure is active.
 * @param useSyncPluginEtc - Whether custom subfolders under plugins are synchronised.
 * @returns Category identifier.
 */
export declare function getFileCategory(filePath: string, configDir: string, useV2: boolean, useSyncPluginEtc: boolean): "CONFIG" | "THEME" | "SNIPPET" | "PLUGIN_MAIN" | "PLUGIN_ETC" | "PLUGIN_DATA" | "";
/**
 * Checks if the file path is a valid customization sync path candidate.
 *
 * @param filePath - Target file path.
 * @param configDir - Vault configuration folder path.
 * @param useV2 - Whether V2 sync is enabled.
 * @param useSyncPluginEtc - Whether config files sync is enabled.
 * @returns True if path is a sync target.
 */
export declare function isTargetPath(filePath: string, configDir: string, useV2: boolean, useSyncPluginEtc: boolean): boolean;
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
export declare function filenameToUnifiedKey(path: string, term: string, configDir: string, useV2: boolean, useSyncPluginEtc: boolean): FilePathWithPrefix;
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
export declare function filenameWithUnifiedKey(path: string, term: string, configDir: string, useV2: boolean, useSyncPluginEtc: boolean): FilePathWithPrefix;
/**
 * Returns database prefix path filter for a terminal configuration.
 *
 * @param term - Active device name.
 * @returns Database path prefix string.
 */
export declare function unifiedKeyPrefixOfTerminal(term: string): FilePathWithPrefix;
/**
 * Parses a V2 unified database path into its constituent components.
 *
 * @param unifiedPath - Unified path metadata document identifier.
 * @returns Parsed components.
 */
export declare function parseUnifiedPath(unifiedPath: FilePathWithPrefix): {
    category: string;
    device: string;
    key: string;
    filename: string;
    pathV1: FilePathWithPrefix;
};
