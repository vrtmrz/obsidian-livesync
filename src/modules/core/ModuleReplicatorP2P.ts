import { REMOTE_P2P, type RemoteDBSettings } from "../../lib/src/common/types";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { AbstractModule } from "../AbstractModule";
import { LiveSyncTrysteroReplicator } from "../../lib/src/replication/trystero/LiveSyncTrysteroReplicator";
import type { LiveSyncCore } from "../../main";

// Note:
// This module registers only the `getNewReplicator` handler for the P2P replicator.
// `useP2PReplicator` (see P2PReplicatorCore.ts) already registers the same `getNewReplicator`
// handler internally, so this module is redundant in environments that call `useP2PReplicator`.
// Register this module only in environments that do NOT use `useP2PReplicator` (e.g. CLI).
// In other words: just resolving `getNewReplicator` via this module is all that is needed
// to satisfy what `useP2PReplicator` requires from the replicator service.
export class ModuleReplicatorP2P extends AbstractModule {
    _anyNewReplicator(settingOverride: Partial<RemoteDBSettings> = {}): Promise<LiveSyncAbstractReplicator | false> {
        const settings = { ...this.settings, ...settingOverride };
        if (settings.remoteType == REMOTE_P2P) {
            return Promise.resolve(new LiveSyncTrysteroReplicator(this.core));
        }
        return Promise.resolve(false);
    }
    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getNewReplicator.addHandler(this._anyNewReplicator.bind(this));
    }
}
