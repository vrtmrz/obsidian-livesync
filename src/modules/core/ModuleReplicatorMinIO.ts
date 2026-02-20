import { REMOTE_MINIO, type RemoteDBSettings } from "../../lib/src/common/types";
import { LiveSyncJournalReplicator } from "../../lib/src/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import type { LiveSyncCore } from "../../main";
import { AbstractModule } from "../AbstractModule";

export class ModuleReplicatorMinIO extends AbstractModule {
    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator | false> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_MINIO) {
            return Promise.resolve(new LiveSyncJournalReplicator(this.core));
        }
        return Promise.resolve(false);
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
    }
}
