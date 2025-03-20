import { REMOTE_P2P, type RemoteDBSettings } from "../../lib/src/common/types";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";
import { LiveSyncTrysteroReplicator } from "../../lib/src/replication/trystero/LiveSyncTrysteroReplicator";

export class ModuleReplicatorP2P extends AbstractModule implements ICoreModule {
    $anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(new LiveSyncTrysteroReplicator(this.core));
        }
        return undefined!;
    }
    $everyAfterResumeProcess(): Promise<boolean> {
        if (this.settings.remoteType == REMOTE_P2P) {
            // // If LiveSync enabled, open replication
            // if (this.settings.liveSync) {
            //     fireAndForget(() => this.core.replicator.openReplication(this.settings, true, false, false));
            // }
            // // If sync on start enabled, open replication
            // if (!this.settings.liveSync && this.settings.syncOnStart) {
            //     // Possibly ok as if only share the result
            //     fireAndForget(() => this.core.replicator.openReplication(this.settings, false, false, false));
            // }
        }

        return Promise.resolve(true);
    }
}
