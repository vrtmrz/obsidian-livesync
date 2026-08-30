import type { SynchronisationInformationResourceFactory } from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { checkSyncInfo } from "@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation";
import { createReplicatorDisposer, snapshotRemoteSettings } from "./shared";

/**
 * Build an unpublished CouchDB synchronisation-information verifier.
 *
 * The resource owns its concrete Replicator and connection, and cannot replace
 * the active provider instance.
 */
export function createCouchDBSynchronisationInformationResourceFactory(
    host: LiveSyncCouchDBReplicatorEnv
): SynchronisationInformationResourceFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        const replicator = new LiveSyncCouchDBReplicator(host);
        return Promise.resolve({
            check: async () => {
                const connection = await replicator.connectRemoteCouchDBWithSetting(
                    snapshot,
                    replicator.isMobile(),
                    true
                );
                if (typeof connection === "string") {
                    return false;
                }
                try {
                    return await checkSyncInfo(connection.db);
                } finally {
                    await connection.close();
                }
            },
            dispose: createReplicatorDisposer(replicator),
        });
    };
}
