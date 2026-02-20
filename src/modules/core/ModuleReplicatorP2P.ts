import { REMOTE_P2P, type RemoteDBSettings } from "../../lib/src/common/types";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "../AbstractModule";
import { LiveSyncTrysteroReplicator } from "../../lib/src/replication/trystero/LiveSyncTrysteroReplicator";
import type { LiveSyncCore } from "../../main";

export class ModuleReplicatorP2P extends AbstractModule {
    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator | false> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(new LiveSyncTrysteroReplicator(this.core));
        }
        return Promise.resolve(false);
    }
    _everyAfterResumeProcess(): Promise<boolean> {
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
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
        services.appLifecycle.onResumed.addHandler(this._everyAfterResumeProcess.bind(this));
    }
}
