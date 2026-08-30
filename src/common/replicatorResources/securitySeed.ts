import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { SecuritySeedResourceFactory } from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import { createReplicatorDisposer, snapshotRemoteSettings, type ResourceReplicator } from "./shared";

/** Host environment sufficient to construct either Security Seed resource. */
export type SecuritySeedResourceHost = LiveSyncCouchDBReplicatorEnv;

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

/** Build an unpublished, independently disposed CouchDB Security Seed resource. */
export function createCouchDBSecuritySeedResourceFactory(host: SecuritySeedResourceHost): SecuritySeedResourceFactory {
    return createSecuritySeedResourceFactory(() => new LiveSyncCouchDBReplicator(host));
}

/** Build an unpublished, independently disposed Object Storage Security Seed resource. */
export function createObjectStorageSecuritySeedResourceFactory(
    host: SecuritySeedResourceHost
): SecuritySeedResourceFactory {
    return createSecuritySeedResourceFactory(() => new LiveSyncJournalReplicator(host));
}
