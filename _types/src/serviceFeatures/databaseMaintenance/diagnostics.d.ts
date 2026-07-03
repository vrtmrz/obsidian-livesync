// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
/**
 * Analyses the database and details chunk utilisation, copying a TSV summary to the clipboard.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export declare function analyseDatabase(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void>;
