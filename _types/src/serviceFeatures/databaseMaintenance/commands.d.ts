// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
/**
 * Registers commands and event listeners for database maintenance capabilities.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function registerDatabaseMaintenanceCommands(host: DatabaseMaintenanceHost, log: LogFunction): void;
