import type { RequiredServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule.js";
import type { PeerStatus } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PReplicatorPaneCommon.js";
import type { UseP2PReplicatorResult } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/UseP2PReplicatorResult.js";

export type P2PReplicatorHandle = Pick<UseP2PReplicatorResult, "replicator">;

/** Host capabilities consumed by the shared P2P pane. */
export interface P2PReplicatorPaneHost {
    readonly services: RequiredServices<"API" | "config" | "setting" | "vault">;
    readonly p2p: P2PReplicatorHandle;
    readonly showPeerMenu?: (peer: PeerStatus, event: MouseEvent) => void;
}
