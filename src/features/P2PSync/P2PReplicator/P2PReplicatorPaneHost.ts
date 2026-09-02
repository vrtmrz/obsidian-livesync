import type { RequiredServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { P2PServiceViews } from "@vrtmrz/livesync-commonlib/p2p";
import type { PeerStatus } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PReplicatorPaneCommon";

/**
 * The shared pane only needs the contracts which represent its visible
 * actions. In particular, it must not receive the compatibility Replicator
 * facade, whose lifecycle methods can bypass the stable P2P service owner.
 */
export type P2PReplicatorPaneP2P = Pick<
    P2PServiceViews,
    "transportLifecycle" | "peerDirectory" | "peerAdmission" | "targetedTransfer" | "changeRelay" | "diagnostics"
>;

/** Host capabilities consumed by the shared P2P pane. */
export interface P2PReplicatorPaneHost {
    readonly services: RequiredServices<"API" | "config" | "setting" | "vault">;
    readonly p2p: P2PReplicatorPaneP2P;
    readonly showPeerMenu?: (peer: PeerStatus, event: MouseEvent) => void;
}
