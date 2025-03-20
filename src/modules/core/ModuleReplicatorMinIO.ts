import { REMOTE_MINIO, type RemoteDBSettings } from "../../lib/src/common/types";
import { LiveSyncJournalReplicator } from "../../lib/src/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";

export class ModuleReplicatorMinIO extends AbstractModule implements ICoreModule {
    $anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_MINIO) {
            return Promise.resolve(new LiveSyncJournalReplicator(this.core));
        }
        return undefined!;
    }
}
