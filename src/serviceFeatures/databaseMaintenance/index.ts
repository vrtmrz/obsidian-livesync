import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceServices, DatabaseMaintenanceModules } from "./types.ts";
import { registerDatabaseMaintenanceCommands } from "./commands.ts";
import {
    gcv3,
    performGC,
    resurrectChunks,
    commitFileDeletion,
    commitChunkDeletion,
    markUnusedChunks,
    removeUnusedChunks,
} from "./garbageCollection.ts";
import { compactDatabase } from "./compaction.ts";
import { analyseDatabase } from "./diagnostics.ts";

/**
 * A service feature hook that initialises and manages the database maintenance module.
 * This registers maintenance commands and provides database compaction, diagnostic, and garbage collection utilities.
 */
export const useDatabaseMaintenance = createObsidianServiceFeature<
    DatabaseMaintenanceServices,
    DatabaseMaintenanceModules,
    "plugin",
    {
        gcv3: () => Promise<void>;
        analyseDatabase: () => Promise<void>;
        compactDatabase: () => Promise<void>;
        performGC: (showingNotice?: boolean) => Promise<void>;
        resurrectChunks: () => Promise<void>;
        commitFileDeletion: () => Promise<void>;
        commitChunkDeletion: () => Promise<void>;
        markUnusedChunks: () => Promise<void>;
        removeUnusedChunks: () => Promise<void>;
    }
>((host) => {
    const log = createInstanceLogFunction("LocalDatabaseMaintenance", host.services.API);

    // Register commands and events
    registerDatabaseMaintenanceCommands(host, log);

    return {
        gcv3: async () => await gcv3(host, log),
        analyseDatabase: async () => await analyseDatabase(host, log),
        compactDatabase: async () => await compactDatabase(host, log),
        performGC: async (showingNotice = false) => await performGC(host, log, showingNotice),
        resurrectChunks: async () => await resurrectChunks(host, log),
        commitFileDeletion: async () => await commitFileDeletion(host, log),
        commitChunkDeletion: async () => await commitChunkDeletion(host, log),
        markUnusedChunks: async () => await markUnusedChunks(host, log),
        removeUnusedChunks: async () => await removeUnusedChunks(host, log),
    };
});
