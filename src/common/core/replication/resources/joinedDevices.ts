import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type {
    JoinedDevicesResource,
    JoinedDevicesResourceFactory,
    JoinedDevicesSnapshot,
    ForgetJoinedDeviceResult,
} from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import { createReplicatorDisposer, snapshotRemoteSettings, type ResourceReplicator } from "./shared";

interface JoinedDevicesReplicator extends ResourceReplicator {
    getJoinedDevices(setting: RemoteDBSettings): Promise<JoinedDevicesSnapshot>;
    forgetJoinedDevice(setting: RemoteDBSettings, deviceId: string): Promise<ForgetJoinedDeviceResult>;
}

function createResource(replicator: JoinedDevicesReplicator, snapshot: RemoteDBSettings): JoinedDevicesResource {
    return {
        read: () => replicator.getJoinedDevices(snapshot),
        forget: (deviceId) => replicator.forgetJoinedDevice(snapshot, deviceId),
        dispose: createReplicatorDisposer(replicator),
    };
}

export function createCouchDBJoinedDevicesResourceFactory(
    host: LiveSyncCouchDBReplicatorEnv
): JoinedDevicesResourceFactory {
    return (setting) =>
        Promise.resolve(createResource(new LiveSyncCouchDBReplicator(host), snapshotRemoteSettings(setting)));
}

export function createObjectStorageJoinedDevicesResourceFactory(
    host: LiveSyncCouchDBReplicatorEnv
): JoinedDevicesResourceFactory {
    return (setting) =>
        Promise.resolve(createResource(new LiveSyncJournalReplicator(host), snapshotRemoteSettings(setting)));
}
