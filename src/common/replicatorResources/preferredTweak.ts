import type { RemoteDBSettings, RemotePreferredTweakResult } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { PreferredTweakProbe, PreferredTweakProbeFactory } from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncJournalReplicatorEnv } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicatorEnv";
import { createReplicatorDisposer, snapshotRemoteSettings, type ResourceReplicator } from "./shared";

export type PreferredTweakResourceHost = LiveSyncCouchDBReplicatorEnv & LiveSyncJournalReplicatorEnv;

interface PreferredTweakReplicator extends ResourceReplicator {
    getRemotePreferredTweakValues(setting: RemoteDBSettings): Promise<RemotePreferredTweakResult>;
}

function createPreferredTweakProbe(
    replicator: PreferredTweakReplicator,
    snapshot: RemoteDBSettings
): PreferredTweakProbe {
    return {
        read: () => replicator.getRemotePreferredTweakValues(snapshot),
        dispose: createReplicatorDisposer(replicator),
    };
}

/** Build an unpublished CouchDB preferred-tweak resource for one host. */
export function createCouchDBPreferredTweakProbeFactory(host: PreferredTweakResourceHost): PreferredTweakProbeFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        return Promise.resolve(createPreferredTweakProbe(new LiveSyncCouchDBReplicator(host), snapshot));
    };
}

/** Build an unpublished Object Storage preferred-tweak resource for one host. */
export function createObjectStoragePreferredTweakProbeFactory(
    host: PreferredTweakResourceHost
): PreferredTweakProbeFactory {
    return (setting) => {
        const snapshot = snapshotRemoteSettings(setting);
        return Promise.resolve(createPreferredTweakProbe(new LiveSyncJournalReplicator(host), snapshot));
    };
}
