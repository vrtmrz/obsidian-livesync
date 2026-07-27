import type {
    AcceptanceDecision,
    RevokeAcceptanceDecision,
} from "@vrtmrz/livesync-commonlib/compat/replication/trystero/TrysteroReplicatorP2PServer";

/** The operations used by the shared P2P pane, independent of its replicator implementation. */
export interface P2PReplicatorPaneController {
    open(): Promise<void>;
    close(): Promise<void>;
    enableBroadcastChanges(): void;
    disableBroadcastChanges(): void;
    makeDecision(decision: AcceptanceDecision): Promise<void>;
    revokeDecision(decision: RevokeAcceptanceDecision): Promise<void>;
    watchPeer(peerId: string): void;
    unwatchPeer(peerId: string): void;
    sync(peerId: string, showNotice?: boolean): Promise<unknown>;
}
