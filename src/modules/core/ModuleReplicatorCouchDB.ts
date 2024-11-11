import { fireAndForget } from "octagonal-wheels/promises";
import { REMOTE_MINIO, type RemoteDBSettings } from "../../lib/src/common/types";
import { LiveSyncCouchDBReplicator } from "../../lib/src/replication/couchdb/LiveSyncReplicator";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";

export class ModuleReplicatorCouchDB extends AbstractModule implements ICoreModule {
    $anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        // If new remote types were added, add them here. Do not use `REMOTE_COUCHDB` directly for the safety valve.
        if (settings.remoteType == REMOTE_MINIO) {
            return undefined!;
        }
        return Promise.resolve(new LiveSyncCouchDBReplicator(this.core));
    }
    $everyAfterResumeProcess(): Promise<boolean> {
        if (this.settings.remoteType != REMOTE_MINIO) {
            // If LiveSync enabled, open replication
            if (this.settings.liveSync) {
                fireAndForget(() => this.core.replicator.openReplication(this.settings, true, false, false));
            }
            // If sync on start enabled, open replication
            if (!this.settings.liveSync && this.settings.syncOnStart) {
                // Possibly ok as if only share the result
                fireAndForget(() => this.core.replicator.openReplication(this.settings, false, false, false));
            }
        }

        return Promise.resolve(true);
    }
}
