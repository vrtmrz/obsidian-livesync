import { REMOTE_MINIO } from "@lib/common/models/setting.const";
import type { RemoteDBSettings } from "@lib/common/models/setting.type";
import { LiveSyncJournalReplicator } from "@lib/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import type { LiveSyncCore } from "@/main";
import { AbstractModule } from "@/modules/AbstractModule";

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
