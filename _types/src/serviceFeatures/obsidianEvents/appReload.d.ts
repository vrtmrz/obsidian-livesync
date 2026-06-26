// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { ObsidianEventsHost } from "./types.ts";
import type { ObsidianEventsState } from "./state.ts";
/**
 * Executes a restart and reload of the Obsidian application.
 *
 * @param host - The service container host.
 */
export declare function performAppReload(host: ObsidianEventsHost): void;
/**
 * Asks the user if they want to restart and reload Obsidian now, scheduling or executing it.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param message - An optional custom message to display in the dialogue.
 */
export declare function askReload(host: ObsidianEventsHost, log: LogFunction, message?: string): void;
/**
 * Schedules an application reload, waiting for all background tasks to stabilise to 0.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export declare function scheduleAppReload(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void;
/**
 * Checks if an application reload has already been scheduled.
 *
 * @param state - The runtime state of the Obsidian events module.
 * @returns True if scheduled, false otherwise.
 */
export declare function isReloadingScheduled(state: ObsidianEventsState): boolean;
