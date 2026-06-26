// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { FilePath, FilePathWithPrefix, LoadedEntry, AnyEntry } from "@lib/common/types.ts";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type { ConfigSyncHost, IPluginDataExDisplay, PluginDataExDisplay, LoadedEntryPluginDataExFile, PluginDataExFile } from "./types.ts";
import type { ConfigSyncState } from "./state.ts";
/**
 * Class representing plugin configuration metadata and display structures for V2 synchronisation.
 */
export declare class PluginDataExDisplayV2 {
    documentPath: FilePathWithPrefix;
    category: string;
    term: string;
    files: LoadedEntryPluginDataExFile[];
    name: string;
    confKey: string;
    constructor(data: IPluginDataExDisplay);
    setFile(file: LoadedEntryPluginDataExFile): Promise<void>;
    deleteFile(filename: string): void;
    _displayName: string | undefined;
    _version: string | undefined;
    applyLoadedManifest(): void;
    get displayName(): string;
    get version(): string | undefined;
    get mtime(): number;
}
/**
 * Reloads the plugin list by clearing the cache and executing updates.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - Whether to display progress messages.
 */
export declare function reloadPluginList(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, showMessage: boolean): Promise<void>;
/**
 * Loads plugin configuration data from the database.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param path - The database document path.
 * @returns Deserialised plugin display details, or false if not found.
 */
export declare function loadPluginData(host: ConfigSyncHost, log: LogFunction, path: FilePathWithPrefix): Promise<PluginDataExDisplay | false>;
/**
 * Creates a V2 plugin metadata descriptor from the unified path.
 *
 * @param host - The service feature host.
 * @param unifiedPathV2 - V2 unified path database key.
 * @returns Initialised plugin display descriptor.
 */
export declare function createPluginDataFromV2(host: ConfigSyncHost, unifiedPathV2: FilePathWithPrefix): PluginDataExDisplayV2 | undefined;
/**
 * Creates a file entry structure from a V2 unified database document.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param unifiedPathV2 - V2 unified path database key.
 * @param loaded - Pre-fetched database document, if available.
 * @returns The V2 file descriptor.
 */
export declare function createPluginDataExFileV2(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, unifiedPathV2: FilePathWithPrefix, loaded?: LoadedEntry): Promise<false | LoadedEntryPluginDataExFile>;
/**
 * Updates the plugin display list for a V2 unified document path.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - Whether to show notifications.
 * @param unifiedFilenameWithKey - Unified database document path.
 */
export declare function updatePluginListV2(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, showMessage: boolean, unifiedFilenameWithKey: FilePathWithPrefix): Promise<void>;
/**
 * Scans the database and updates the active configuration items list.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - Whether to show progress messages.
 * @param updatedDocumentPath - Optional target document path to narrow update.
 */
export declare function updatePluginList(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, showMessage: boolean, updatedDocumentPath?: FilePathWithPrefix): Promise<void>;
/**
 * Migrates configuration sync structure V1 (single monolithic metadata doc) to V2 (split documents).
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param showMessage - Whether to show progress logs in UI.
 * @param entry - The database entry to migrate.
 */
export declare function migrateV1ToV2(host: ConfigSyncHost, log: LogFunction, showMessage: boolean, entry: AnyEntry): Promise<void>;
/**
 * Helper to recursively list files in Obsidian storage up to a given depth.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param path - The folder path.
 * @param lastDepth - Remaining depth levels to traverse.
 * @returns Array of file paths found.
 */
export declare function getFiles(host: ConfigSyncHost, log: LogFunction, path: string, lastDepth: number): Promise<string[]>;
/**
 * Scans internal configuration files in Obsidian storage config folder.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @returns Array of configuration file paths.
 */
export declare function scanInternalFiles(host: ConfigSyncHost, log: LogFunction): Promise<FilePath[]>;
/**
 * Creates a file details entry from a local storage file.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param path - Local file path.
 * @returns File descriptor details, or false if stat fails.
 */
export declare function makeEntryFromFile(host: ConfigSyncHost, log: LogFunction, path: FilePath): Promise<false | PluginDataExFile>;
/**
 * Creates a QueueProcessor for scanning V1 plugins.
 */
export declare function createPluginScanProcessor(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState): QueueProcessor<AnyEntry, never>;
/**
 * Creates a QueueProcessor for scanning V2 plugins.
 */
export declare function createPluginScanProcessorV2(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState): QueueProcessor<AnyEntry, never>;
