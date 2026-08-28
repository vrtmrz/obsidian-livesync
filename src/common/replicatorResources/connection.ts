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
import type { LiveSyncJournalReplicatorEnv } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicatorEnv";
import { createReplicatorDisposer, snapshotRemoteSettings } from "./shared";

export type ConnectionResourceHost = LiveSyncCouchDBReplicatorEnv & LiveSyncJournalReplicatorEnv;

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

/** Build an unpublished CouchDB connection resource for one host. */
export function createCouchDBConnectionProbeFactory(host: ConnectionResourceHost): ConnectionProbeFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        return Promise.resolve(createCouchDBConnectionProbe(new LiveSyncCouchDBReplicator(host), snapshot));
    };
}

/** Build an unpublished Object Storage connection resource for one host. */
export function createObjectStorageConnectionProbeFactory(host: ConnectionResourceHost): ConnectionProbeFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        return Promise.resolve(createObjectStorageConnectionProbe(new LiveSyncJournalReplicator(host), snapshot));
    };
}
