// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { ConfigSyncHost } from "./types.ts";
/**
 * Registers commands, ribbon icons, and custom SVG icons for configuration synchronisation.
 *
 * @param host - The service feature host.
 * @param handlers - Action triggers.
 */
export declare function registerConfigSyncCommands(host: ConfigSyncHost, handlers: {
    showPluginSyncModal: () => void;
}): void;
