import { fireAndForget } from "octagonal-wheels/promises";
import { REMOTE_MINIO, REMOTE_P2P, type RemoteDBSettings } from "@lib/common/types";
import { LiveSyncCouchDBReplicator } from "@lib/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@lib/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import type { NecessaryObsidianFeature } from "@/types";

type CouchDBReplicatorHost = NecessaryObsidianFeature<"replicator" | "appLifecycle" | "replication" | "setting">;

export const createCouchDBReplicatorHandler = (
    host: CouchDBReplicatorHost,
    settingOverride: Partial<RemoteDBSettings> = {}
): Promise<LiveSyncAbstractReplicator | false> => {
    const currentSettings = { ...host.services.setting.settings, ...settingOverride };
    if (currentSettings.remoteType == REMOTE_MINIO || currentSettings.remoteType == REMOTE_P2P) {
        return Promise.resolve(false);
    }
    return Promise.resolve(new LiveSyncCouchDBReplicator(host as any));
};

export const resumeCouchDBReplicationHandler = (host: CouchDBReplicatorHost): Promise<boolean> => {
    const { services } = host;
    const settings = services.setting.settings;

    if (services.appLifecycle.isSuspended()) return Promise.resolve(true);
    if (!services.appLifecycle.isReady()) return Promise.resolve(true);
    if (settings.remoteType != REMOTE_MINIO && settings.remoteType != REMOTE_P2P) {
        const LiveSyncEnabled = settings.liveSync;
        const continuous = LiveSyncEnabled;
        const eventualOnStart = !LiveSyncEnabled && settings.syncOnStart;
        if (LiveSyncEnabled || eventualOnStart) {
            fireAndForget(async () => {
                const canReplicate = await services.replication.isReplicationReady(false);
                if (!canReplicate) return;
                void services.replicator.getActiveReplicator()?.openReplication(settings, continuous, false, false);
            });
        }
    }
    return Promise.resolve(true);
};

export function useCouchDBReplicatorFactory(host: CouchDBReplicatorHost) {
    host.services.replicator.getNewReplicator.addHandler(createCouchDBReplicatorHandler.bind(null, host));
    host.services.appLifecycle.onResumed.addHandler(resumeCouchDBReplicationHandler.bind(null, host));
}

type MinIOReplicatorHost = NecessaryObsidianFeature<"replicator" | "setting">;

export const createMinIOReplicatorHandler = (
    host: MinIOReplicatorHost,
    settingOverride: Partial<RemoteDBSettings> = {}
): Promise<LiveSyncAbstractReplicator | false> => {
    const currentSettings = { ...host.services.setting.settings, ...settingOverride };
    if (currentSettings.remoteType == REMOTE_MINIO) {
        return Promise.resolve(new LiveSyncJournalReplicator(host as any));
    }
    return Promise.resolve(false);
};

export function useMinIOReplicatorFactory(host: MinIOReplicatorHost) {
    host.services.replicator.getNewReplicator.addHandler(createMinIOReplicatorHandler.bind(null, host));
}
