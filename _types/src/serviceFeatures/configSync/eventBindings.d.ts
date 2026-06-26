// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { FilePath } from "@lib/common/types.ts";
import type { ConfigSyncHost } from "./types.ts";
import type { ConfigSyncState } from "./state.ts";
/**
 * Binds all required events for configuration synchronisation onto the application lifecycle and replicator.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param handlers - Event response triggers.
 */
export declare function bindConfigSyncEvents(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, handlers: {
    showPluginSyncModal: () => void;
    watchVaultRawEventsAsync: (path: FilePath) => Promise<boolean>;
}): void;
/**
 * Configures the customisation synchronisation status.
 *
 * @param host - The service feature host.
 * @param log - The logging function.
 * @param state - The configuration sync state.
 * @param mode - The sync activation mode option.
 */
export declare function configureHiddenFileSync(host: ConfigSyncHost, log: LogFunction, state: ConfigSyncState, mode: "DISABLE" | "CUSTOMIZE" | "DISABLE_CUSTOM"): Promise<void>;
