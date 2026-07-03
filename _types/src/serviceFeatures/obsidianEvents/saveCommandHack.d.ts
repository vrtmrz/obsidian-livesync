// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { ObsidianEventsHost } from "./types.ts";
import type { ObsidianEventsState } from "./state.ts";
/**
 * Swaps the default Obsidian save command callback to trigger a synchronisation sweep.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export declare function swapSaveCommand(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void;
