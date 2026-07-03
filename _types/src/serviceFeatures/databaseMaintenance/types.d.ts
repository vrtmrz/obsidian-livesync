// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryObsidianServices } from "@/types.ts";
/**
 * A union of service keys required by the database maintenance feature.
 */
export type DatabaseMaintenanceServices = "API" | "setting" | "UI" | "database" | "keyValueDB" | "replication" | "replicator" | "vault";
/**
 * A union of service module keys required by the database maintenance feature.
 */
export type DatabaseMaintenanceModules = "storageAccess";
/**
 * The host type representing the injected service container with database maintenance capabilities.
 */
export type DatabaseMaintenanceHost = NecessaryObsidianServices<DatabaseMaintenanceServices, DatabaseMaintenanceModules, "plugin">;
