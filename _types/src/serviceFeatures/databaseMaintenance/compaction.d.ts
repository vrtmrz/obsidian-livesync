// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
/**
 * Commands the remote CouchDB database to perform compaction and monitors its progress.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function compactDatabase(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
