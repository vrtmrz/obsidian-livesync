// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { LiveSyncTrysteroReplicator } from "./LiveSyncTrysteroReplicator";
import type { Advertisement } from "./types";
/**
 * Minimal interface that a P2P replicator instance should satisfy for addP2PEventHandlers to work.
 */
export interface P2PReplicatorLike {
    onNewPeer(peer: Advertisement): Promise<void> | void;
    onPeerLeaved(peerId: string): void;
    requestStatus(): void;
    open(): Promise<void>;
    close(): Promise<void>;
    /** Indicates whether the room is currently active. */
    readonly isServing?: boolean;
    /** Legacy: host object that may carry isServing (LiveSyncTrysteroReplicator). */
    readonly server?: {
        isServing?: boolean;
    };
}
/**
 * Add event handlers for P2P replication related events.
 * @param instance P2PReplicatorLike instance
 */
export declare function addP2PEventHandlers(instance: P2PReplicatorLike): void;
/**
 * open P2P replicator if not opened yet.
 * @param instance
 */
export declare function openP2PReplicator(instance: P2PReplicatorLike): Promise<void>;
/**
 * close P2P replicator
 * @param instance
 */
export declare function closeP2PReplicator(instance: P2PReplicatorLike): Promise<void>;
export type { LiveSyncTrysteroReplicator };
