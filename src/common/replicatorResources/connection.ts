import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type {
    ConnectionProbeFactory,
    RemoteConnectionProbe,
    RemoteConnectionProbeOptions,
} from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import { createReplicatorDisposer, snapshotRemoteSettings } from "./shared";

/** Host environment sufficient to construct either central connection probe. */
export type ConnectionResourceHost = LiveSyncCouchDBReplicatorEnv;

function createCouchDBConnectionProbe(
    replicator: LiveSyncCouchDBReplicator,
    snapshot: RemoteDBSettings
): RemoteConnectionProbe {
    const dispose = createReplicatorDisposer(replicator);
    return {
        check: async (options: RemoteConnectionProbeOptions = {}) => {
            const connection = await replicator.connectRemoteCouchDBWithSetting(
                snapshot,
                replicator.isMobile(),
                options.createIfMissing ?? true,
                false
            );
            if (typeof connection === "string") {
                return { ok: false, reason: connection };
            }
            try {
                return { ok: true };
            } finally {
                await connection.close();
            }
        },
        getStatus: () => replicator.getRemoteStatus(snapshot),
        dispose,
    };
}

function createObjectStorageConnectionProbe(
    replicator: LiveSyncJournalReplicator,
    snapshot: RemoteDBSettings
): RemoteConnectionProbe {
    const dispose = createReplicatorDisposer(replicator);
    return {
        check: async (options: RemoteConnectionProbeOptions = {}) => {
            try {
                const connected = await replicator.tryConnectRemote(snapshot, options.showResult ?? false);
                return connected ? { ok: true } : { ok: false };
            } catch (error) {
                return { ok: false, reason: error };
            }
        },
        getStatus: () => replicator.getRemoteStatus(snapshot),
        dispose,
    };
}

/**
 * Build an unpublished CouchDB connection probe for one host.
 *
 * The probe owns both its concrete Replicator and each connection it opens. It
 * never publishes that Replicator as the active provider instance.
 */
export function createCouchDBConnectionProbeFactory(host: ConnectionResourceHost): ConnectionProbeFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        return Promise.resolve(createCouchDBConnectionProbe(new LiveSyncCouchDBReplicator(host), snapshot));
    };
}

/**
 * Build an unpublished Object Storage connection probe for one host.
 *
 * The probe owns its concrete Replicator and never publishes or replaces the
 * active provider instance.
 */
export function createObjectStorageConnectionProbeFactory(host: ConnectionResourceHost): ConnectionProbeFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        return Promise.resolve(createObjectStorageConnectionProbe(new LiveSyncJournalReplicator(host), snapshot));
    };
}
