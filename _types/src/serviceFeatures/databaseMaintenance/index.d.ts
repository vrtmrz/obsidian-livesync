// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { DatabaseMaintenanceServices } from "./types.ts";
/**
 * A service feature hook that initialises and manages the database maintenance module.
 * This registers maintenance commands and provides database compaction, diagnostic, and garbage collection utilities.
 */
export declare const useDatabaseMaintenance: import("@/types.ts").ObsidianServiceFeatureFunction<DatabaseMaintenanceServices, "storageAccess", "plugin", {
    gcv3: () => Promise<void>;
    analyseDatabase: () => Promise<void>;
    compactDatabase: () => Promise<void>;
    performGC: (showingNotice?: boolean) => Promise<void>;
    resurrectChunks: () => Promise<void>;
    commitFileDeletion: () => Promise<void>;
    commitChunkDeletion: () => Promise<void>;
    markUnusedChunks: () => Promise<void>;
    removeUnusedChunks: () => Promise<void>;
}>;
