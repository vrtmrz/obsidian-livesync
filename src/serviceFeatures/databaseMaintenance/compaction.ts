import { LOG_LEVEL_NOTICE } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import { delay } from "@lib/common/utils.ts";
import type { LiveSyncCouchDBReplicator } from "@lib/replication/couchdb/LiveSyncReplicator.ts";
import type { DatabaseMaintenanceHost } from "./types.ts";

/**
 * Commands the remote CouchDB database to perform compaction and monitors its progress.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export async function compactDatabase(host: DatabaseMaintenanceHost, log: LogFunction): Promise<void> {
    const settings = host.services.setting.currentSettings();
    const replicator = host.services.replicator.getActiveReplicator() as LiveSyncCouchDBReplicator;
    if (!replicator) {
        log("No active replicator found for compaction.", LOG_LEVEL_NOTICE, "gc-compact");
        return;
    }
    const remote = await replicator.connectRemoteCouchDBWithSetting(settings, false, false, true);
    if (!remote) {
        log("Failed to connect to remote for compaction.", LOG_LEVEL_NOTICE, "gc-compact");
        return;
    }
    if (typeof remote === "string") {
        log(`Failed to connect to remote for compaction. ${remote}`, LOG_LEVEL_NOTICE, "gc-compact");
        return;
    }
    const compactResult = await remote.db.compact({
        interval: 1000,
    });

    let timeout = 2 * 60 * 1000; // 2 minutes
    while (true) {
        const status = await remote.db.info();
        if ("compact_running" in status && status?.compact_running) {
            log("Compaction in progress on remote database...", LOG_LEVEL_NOTICE, "gc-compact");
            await delay(2000);
            timeout -= 2000;
            if (timeout <= 0) {
                log("Compaction on remote database timed out.", LOG_LEVEL_NOTICE, "gc-compact");
                break;
            }
        } else {
            break;
        }
    }
    if (compactResult && "ok" in compactResult) {
        log("Compaction on remote database completed successfully.", LOG_LEVEL_NOTICE, "gc-compact");
    } else {
        log("Compaction on remote database failed.", LOG_LEVEL_NOTICE, "gc-compact");
    }
}
