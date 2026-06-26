// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";
/**
 * Checks whether the hidden file synchronisation module is enabled in the current settings.
 *
 * @param host - The service feature host providing access to services.
 * @returns True if the synchronisation of internal/hidden files is enabled; otherwise, false.
 */
export declare function isThisModuleEnabled(host: HiddenFileSyncHost): boolean;
/**
 * Checks whether the local database is ready and available for operations.
 *
 * @param host - The service feature host providing access to services.
 * @returns True if the database is ready; otherwise, false.
 */
export declare function isDatabaseReady(host: HiddenFileSyncHost): boolean;
/**
 * Determines if the hidden file synchronisation module is ready to execute.
 * It checks if the application lifecycle is ready, is not suspended, and the module is enabled.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @returns True if the module is ready; otherwise, false.
 */
export declare function isReady(host: HiddenFileSyncHost, state: HiddenFileSyncState): boolean;
/**
 * Clears the cached configuration and regular expressions when settings are updated.
 *
 * @param host - The service feature host providing access to services.
 * @param state - The runtime state of the hidden file synchronisation module.
 */
export declare function updateSettingCache(host: HiddenFileSyncHost, state: HiddenFileSyncState): void;
/**
 * Performs the initial synchronisation scan during startup.
 * It invokes the offline changes application handler to process pending local and database modifications.
 *
 * @param host - The service feature host providing access to services.
 * @param log - The logging function.
 * @param state - The runtime state of the hidden file synchronisation module.
 * @param showNotice - Whether to show system notices for the progress of the operations.
 * @param applyOfflineChanges - The callback function to apply offline modifications.
 */
export declare function performStartupScan(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, showNotice: boolean, applyOfflineChanges: (showNotice: boolean) => Promise<void>): Promise<void>;
