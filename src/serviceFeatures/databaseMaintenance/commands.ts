import { EVENT_ANALYSE_DB_USAGE, EVENT_REQUEST_PERFORM_GC_V3, eventHub } from "@/common/events.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";
import { gcv3 } from "./garbageCollection.ts";
import { analyseDatabase } from "./diagnostics.ts";

/**
 * Registers commands and event listeners for database maintenance capabilities.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export function registerDatabaseMaintenanceCommands(host: DatabaseMaintenanceHost, log: LogFunction): void {
    const plugin = host.context.plugin;
    if (plugin) {
        plugin.addCommand({
            id: "analyse-database",
            name: "Analyse Database Usage (advanced)",
            icon: "database-search",
            callback: async () => {
                await analyseDatabase(host, log);
            },
        });
        plugin.addCommand({
            id: "gc-v3",
            name: "Garbage Collection V3 (advanced, beta)",
            icon: "trash-2",
            callback: async () => {
                await gcv3(host, log);
            },
        });
        plugin.addCommand({
            id: "livesync-scan-files",
            name: "Scan storage and database again",
            callback: async () => {
                await host.services.vault.scanVault(true);
            },
        });
    }

    eventHub.onEvent(EVENT_ANALYSE_DB_USAGE, () => {
        void analyseDatabase(host, log);
    });
    eventHub.onEvent(EVENT_REQUEST_PERFORM_GC_V3, () => {
        void gcv3(host, log);
    });
}
