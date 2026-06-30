// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { type UseP2PReplicatorResult } from "@lib/replication/trystero/UseP2PReplicatorResult";
import { P2PLogCollector } from "@lib/replication/trystero/P2PLogCollector";
import type { LiveSyncCore } from "@/main";
/**
 * ServiceFeature: P2P Replicator lifecycle management.
 * Binds a LiveSyncTrysteroReplicator to the host's lifecycle events,
 * following the same middleware style as useOfflineScanner.
 *
 * @param viewTypeAndFactory  Optional [viewType, factory] pair for registering the P2P pane view.
 *                            When provided, also registers commands and ribbon icon via services.API.
 */
export declare function useP2PReplicatorUI(host: NecessaryServices<"API" | "appLifecycle" | "setting" | "vault" | "database" | "databaseEvents" | "keyValueDB" | "replication" | "config" | "UI" | "replicator", never>, core: LiveSyncCore, replicator: UseP2PReplicatorResult): {
    replicator: import("../lib/src/replication/trystero/LiveSyncTrysteroReplicator").LiveSyncTrysteroReplicator;
    p2pLogCollector: P2PLogCollector;
    storeP2PStatusLine: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<string>;
};
