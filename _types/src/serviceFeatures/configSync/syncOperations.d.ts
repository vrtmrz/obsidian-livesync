// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { FilePath, FilePathWithPrefix } from "@lib/common/types.ts";
import type { ConfigSyncHost, IPluginDataExDisplay, PluginDataEx } from "./types.ts";
import type { ConfigSyncState } from "./state.ts";
import { PluginDataExDisplayV2 } from "./pluginScanner.ts";
/**
 * Checks whether the configuration synchronisation module is enabled in settings.
 *
 * @param host - The service feature host.
 * @returns True if enabled, false otherwise.
 */
export declare function isThisModuleEnabled(host: ConfigSyncHost): boolean;
/**
 * Compares two plugin data sets by displaying a resolve modal dialog.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param dataA - Left hand configuration item.
 * @param dataB - Right hand configuration item.
 * @param compareEach - Whether to compare file by file.
 * @returns Promise resolving to true if applied successfully, false otherwise.
 */
export declare function compareUsingDisplayData(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, dataA: IPluginDataExDisplay, dataB: IPluginDataExDisplay, compareEach?: boolean): Promise<boolean>;
/**
 * Applies customization data for V2 split files.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param data - The plugin V2 display model.
 * @param content - Optional specific file content override.
 * @returns True if applied successfully, false otherwise.
 */
export declare function applyDataV2(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, data: PluginDataExDisplayV2, content?: string): Promise<boolean>;
/**
 * Applies configuration data to local storage and updates active systems.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param data - The configuration display description.
 * @param content - Optional merged file content.
 * @returns True if successful, false otherwise.
 */
export declare function applyData(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, data: IPluginDataExDisplay, content?: string): Promise<boolean>;
/**
 * Deletes configuration documents from the database and runs status updates.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param data - The target plugin configurations to clean up.
 * @returns True if successful, false otherwise.
 */
export declare function deleteData(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, data: PluginDataEx): Promise<boolean>;
/**
 * Stores a customization file in V2 database split format.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param path - Local file path.
 * @param term - Local terminal name.
 * @param force - True to bypass change verification checks.
 * @returns Database operation response structure.
 */
export declare function storeCustomisationFileV2(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, path: FilePath, term: string, force?: boolean): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Stores local customization files to database records.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param path - Local file path.
 * @param termOverRide - Device identifier override.
 * @returns DB operation response.
 */
export declare function storeCustomizationFiles(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, path: FilePath, termOverRide?: string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Marks config file deleted in the database.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param prefixedFileName - Unified db file path.
 * @param forceWrite - Force deletion write operation.
 * @returns True if successfully marked deleted, false otherwise.
 */
export declare function deleteConfigOnDatabase(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, prefixedFileName: FilePathWithPrefix, forceWrite?: boolean): Promise<boolean>;
/**
 * Scans all customization config files, comparing local and DB databases.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param showMessage - True to print progress messages.
 */
export declare function scanAllConfigFiles(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, showMessage: boolean): Promise<void>;
/**
 * Monitors and processes Obsidian storage raw file events for synchronisation.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param path - The modified file path.
 * @returns True if processed, false otherwise.
 */
export declare function watchVaultRawEventsAsync(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, path: FilePath): Promise<boolean>;
