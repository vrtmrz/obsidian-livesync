// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { TFile } from "@/deps.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { ObsidianEventsHost } from "./types.ts";
import type { ObsidianEventsState } from "./state.ts";
/**
 * Sets the focus status and triggers visibility check scheduling.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 * @param hasFocus - The new focus status.
 */
export declare function setHasFocus(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState, hasFocus: boolean): void;
/**
 * Schedules a task to check and apply window visibility transitions.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export declare function watchWindowVisibility(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void;
/**
 * Asynchronously processes window visibility transitions, suspending or resuming replication channels.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export declare function watchWindowVisibilityAsync(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): Promise<void>;
/**
 * Schedules a task to check online recovery and vault rescanning.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function watchOnline(host: ObsidianEventsHost, log: LogFunction): void;
/**
 * Asynchronously checks if online recovery is required, performing a vault scan if the network recovers.
 *
 * @param host - The service container host.
 */
export declare function watchOnlineAsync(host: ObsidianEventsHost): Promise<void>;
/**
 * Schedules a task to process files opened in the workspace.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param file - The file that was opened.
 */
export declare function watchWorkspaceOpen(host: ObsidianEventsHost, log: LogFunction, file: TFile | null): void;
/**
 * Asynchronously handles workspace file open events, running replication and checking for conflicts.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param file - The file that was opened.
 */
export declare function watchWorkspaceOpenAsync(host: ObsidianEventsHost, log: LogFunction, file: TFile): Promise<void>;
