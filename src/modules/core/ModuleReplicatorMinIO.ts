import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { isJournalRemoteType } from "@vrtmrz/livesync-commonlib/journal-storage";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncAbstractReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/LiveSyncAbstractReplicator";
import type { LiveSyncCore } from "@/main";
import { AbstractModule } from "@/modules/AbstractModule";

export class ModuleReplicatorMinIO extends AbstractModule {
    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator | false> {
        const settings = { ...this.settings, ...settingOverride };
        if (isJournalRemoteType(settings.remoteType)) {
            return Promise.resolve(new LiveSyncJournalReplicator(this.core));
        }
        return Promise.resolve(false);
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
    }
}
