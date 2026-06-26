// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type LOG_LEVEL } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
/**
 * Checks if garbage collection can be performed based on plug-in settings.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @returns True if garbage collection is available, false otherwise.
 */
export declare function isGCAvailable(host: DatabaseMaintenanceHost, log: LogFunction): boolean;
/**
 * Shows a confirmation dialogue to the user with customiseable options.
 *
 * @param host - The service container host.
 * @param title - The title of the dialogue.
 * @param message - The body message of the dialogue.
 * @param affirmative - The positive confirmation label.
 * @param negative - The negative cancellation label.
 * @returns A promise resolving to true if approved, false otherwise.
 */
export declare function confirmDialogue(host: DatabaseMaintenanceHost, title: string, message: string, affirmative?: string, negative?: string): Promise<boolean>;
/**
 * Retrieves all chunk information from the local database.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param includeDeleted - Whether to include deleted chunks in the scan.
 * @returns A promise resolving to the retrieved chunk collections.
 */
export declare function retrieveAllChunks(host: DatabaseMaintenanceHost, log: LogFunction, includeDeleted?: boolean): Promise<{
    used: Set<string>;
    existing: Map<string, import("@lib/common/types.ts").EntryLeaf>;
}>;
/**
 * Creates a progress bar tracker that logs lifecycle states.
 *
 * @param log - The logger function.
 * @param prefix - A text prefix to prepend to all progress messages.
 * @param level - The log level for progress updates.
 * @returns An object to log, perform once-off updates, or finish the progress.
 */
export declare function createProgressBar(log: LogFunction, prefix?: string, level?: LOG_LEVEL): {
    log: (msg: string) => void;
    once: (msg: string) => void;
    done: (msg?: string) => void;
};
