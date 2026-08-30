import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SecuritySeedResourceFactory } from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncJournalReplicatorEnv } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicatorEnv";
import { createReplicatorDisposer, snapshotRemoteSettings, type ResourceReplicator } from "./shared";

export type SecuritySeedResourceHost = LiveSyncCouchDBReplicatorEnv & LiveSyncJournalReplicatorEnv;

/** Minimal private Replicator surface required by a Security Seed resource. */
interface SecuritySeedReplicator extends ResourceReplicator {
    getReplicationPBKDF2Salt(setting: RemoteDBSettings, refresh?: boolean): Promise<Uint8Array<ArrayBuffer>>;
}

function createSecuritySeedResourceFactory(
    createReplicator: () => SecuritySeedReplicator
): SecuritySeedResourceFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        const replicator = createReplicator();
        return Promise.resolve({
            read: () => replicator.getReplicationPBKDF2Salt(snapshot),
            dispose: createReplicatorDisposer(replicator),
        });
    };
}

/** Build an unpublished CouchDB Security Seed resource for one host. */
export function createCouchDBSecuritySeedResourceFactory(host: SecuritySeedResourceHost): SecuritySeedResourceFactory {
    return createSecuritySeedResourceFactory(() => new LiveSyncCouchDBReplicator(host));
}

/** Build an unpublished Object Storage Security Seed resource for one host. */
export function createObjectStorageSecuritySeedResourceFactory(
    host: SecuritySeedResourceHost
): SecuritySeedResourceFactory {
    return createSecuritySeedResourceFactory(() => new LiveSyncJournalReplicator(host));
}
