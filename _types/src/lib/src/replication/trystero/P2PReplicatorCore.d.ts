// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import type { P2PPaneParams } from "./UseP2PReplicatorResult";
export type P2PViewFactory = (leaf: unknown) => unknown;
/**
 * ServiceFeature: P2P Replicator lifecycle management.
 * Binds a LiveSyncTrysteroReplicator to the host's lifecycle events,
 * following the same middleware style as useOfflineScanner.
 *
 * @param viewTypeAndFactory  Optional [viewType, factory] pair for registering the P2P pane view.
 *                            When provided, also registers commands and ribbon icon via services.API.
 */
export declare function useP2PReplicator(host: NecessaryServices<"API" | "appLifecycle" | "setting" | "vault" | "database" | "databaseEvents" | "keyValueDB" | "replication" | "config" | "UI" | "replicator" | "remote", never>, viewTypeAndFactory?: [viewType: string, factory: P2PViewFactory]): P2PPaneParams;
