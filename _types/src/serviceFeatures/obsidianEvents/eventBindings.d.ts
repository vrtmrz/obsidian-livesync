// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { ObsidianEventsState } from "./state.ts";
import type { ObsidianEventsHost } from "./types.ts";
export declare function registerVaultAndWorkspaceEvents(host: ObsidianEventsHost): Promise<boolean>;
export declare function registerWindowWatchEvents(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void;
export declare function onObsidianEventsLayoutReady(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): Promise<boolean>;
export declare function bindObsidianEventsLifecycle(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void;
