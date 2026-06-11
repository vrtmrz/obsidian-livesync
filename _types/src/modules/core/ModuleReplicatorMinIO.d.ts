import type { RemoteDBSettings } from "@lib/common/models/setting.type";
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import type { LiveSyncCore } from "@/main";
import { AbstractModule } from "@/modules/AbstractModule";
export declare class ModuleReplicatorMinIO extends AbstractModule {
    _anyNewReplicator(settingOverride?: Partial<RemoteDBSettings>): Promise<LiveSyncAbstractReplicator | false>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
