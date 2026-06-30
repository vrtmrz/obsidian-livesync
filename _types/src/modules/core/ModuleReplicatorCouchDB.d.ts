// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type RemoteDBSettings } from "@lib/common/types";
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "@/modules/AbstractModule";
import type { LiveSyncCore } from "@/main";
export declare class ModuleReplicatorCouchDB extends AbstractModule {
    _anyNewReplicator(settingOverride?: Partial<RemoteDBSettings>): Promise<LiveSyncAbstractReplicator | false>;
    _everyAfterResumeProcess(): Promise<boolean>;
    onBindFunction(core: LiveSyncCore, services: typeof core.services): void;
}
