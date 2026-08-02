import { fireAndForget } from "octagonal-wheels/promises";
import type { RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { defaultRemoteProviderRegistry } from "@vrtmrz/livesync-commonlib/remote-configurations";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import type { LiveSyncAbstractReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "@/modules/AbstractModule";
import type { LiveSyncCore } from "@/main";

export class ModuleReplicatorCouchDB extends AbstractModule {
    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator | false> {
        const settings = { ...this.settings, ...settingOverride };
        if (!defaultRemoteProviderRegistry.isRemoteTypeInFamily(settings.remoteType, "couchdb")) {
            return Promise.resolve(false);
        }
        return Promise.resolve(new LiveSyncCouchDBReplicator(this.core));
    }
    _everyAfterResumeProcess(): Promise<boolean> {
        if (this.services.appLifecycle.isSuspended()) return Promise.resolve(true);
        if (!this.services.appLifecycle.isReady()) return Promise.resolve(true);
        if (defaultRemoteProviderRegistry.isRemoteTypeInFamily(this.settings.remoteType, "couchdb")) {
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
                    const openReplication = () =>
                        this.core.replicator.openReplication(this.settings, continuous, false, false);
                    if (continuous) {
                        void openReplication();
                    } else {
                        await this.services.replicator.runFiniteReplicationActivity(openReplication, {
                            label: "replication",
                        });
                    }
                });
            }
        }

        return Promise.resolve(true);
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
        services.appLifecycle.onResumed.addHandler(this._everyAfterResumeProcess.bind(this));
    }
}
