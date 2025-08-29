import { fireAndForget } from "octagonal-wheels/promises";
import { REMOTE_MINIO, REMOTE_P2P, type RemoteDBSettings } from "../../lib/src/common/types";
import { LiveSyncCouchDBReplicator } from "../../lib/src/replication/couchdb/LiveSyncReplicator";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";

export class ModuleReplicatorCouchDB extends AbstractModule implements ICoreModule {
    $anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        // If new remote types were added, add them here. Do not use `REMOTE_COUCHDB` directly for the safety valve.
        if (settings.remoteType == REMOTE_MINIO || settings.remoteType == REMOTE_P2P) {
            return undefined!;
        }
        return Promise.resolve(new LiveSyncCouchDBReplicator(this.core));
    }
    $everyAfterResumeProcess(): Promise<boolean> {
        if (!this.core.$$isSuspended) return Promise.resolve(true);
        if (!this.core.$$isReady) return Promise.resolve(true);
        if (this.settings.remoteType != REMOTE_MINIO && this.settings.remoteType != REMOTE_P2P) {
            const LiveSyncEnabled = this.settings.liveSync;
            const continuous = LiveSyncEnabled;
            const eventualOnStart = !LiveSyncEnabled && this.settings.syncOnStart;

            // If enabled LiveSync or on start, open replication
            if (LiveSyncEnabled || eventualOnStart) {
                // And note that we do not open the conflict detection dialogue directly during this process.
                // This should be raised explicitly if needed.
                fireAndForget(async () => {
                    const canReplicate = await this.core.$$canReplicate(false);
                    if (!canReplicate) return;
                    void this.core.replicator.openReplication(this.settings, continuous, false, false);
                });
            }
        }

        return Promise.resolve(true);
    }
}
