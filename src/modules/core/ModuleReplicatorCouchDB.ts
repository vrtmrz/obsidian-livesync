import { fireAndForget } from "octagonal-wheels/promises";
import { REMOTE_MINIO, REMOTE_P2P, type RemoteDBSettings } from "../../lib/src/common/types";
import { LiveSyncCouchDBReplicator } from "../../lib/src/replication/couchdb/LiveSyncReplicator";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "../AbstractModule";
import type { LiveSyncCore } from "../../main";

export class ModuleReplicatorCouchDB extends AbstractModule {
    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator | false> {
        const settings = { ...this.settings, ...settingOverride };
        // If new remote types were added, add them here. Do not use `REMOTE_COUCHDB` directly for the safety valve.
        if (settings.remoteType == REMOTE_MINIO || settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(false);
        }
        return Promise.resolve(new LiveSyncCouchDBReplicator(this.core));
    }
    _everyAfterResumeProcess(): Promise<boolean> {
        if (this.services.appLifecycle.isSuspended()) return Promise.resolve(true);
        if (!this.services.appLifecycle.isReady()) return Promise.resolve(true);
        if (this.settings.remoteType != REMOTE_MINIO && this.settings.remoteType != REMOTE_P2P) {
            const LiveSyncEnabled = this.settings.liveSync;
            const continuous = LiveSyncEnabled;
            const eventualOnStart = !LiveSyncEnabled && this.settings.syncOnStart;
            // If enabled LiveSync or on start, open replication
            if (LiveSyncEnabled || eventualOnStart) {
                // And note that we do not open the conflict detection dialogue directly during this process.
                // This should be raised explicitly if needed.
                fireAndForget(async () => {
                    const canReplicate = await this.services.replication.isReplicationReady(false);
                    if (!canReplicate) return;
                    void this.core.replicator.openReplication(this.settings, continuous, false, false);
                });
            }
        }

        return Promise.resolve(true);
    }
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.handleGetNewReplicator(this._anyNewReplicator.bind(this));
        services.appLifecycle.handleOnResumed(this._everyAfterResumeProcess.bind(this));
    }
}
