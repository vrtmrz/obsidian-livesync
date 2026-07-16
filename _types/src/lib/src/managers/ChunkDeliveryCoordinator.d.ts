// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: bbf2539
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import type { DocumentID } from "@lib/common/types";
/**
 * A last-resort leak fuse for an accepted delivery claim which reports no
 * observable progress. It releases logical ownership so a waiter, and an
 * entered bounded activity with its Wake Lock and indicator, cannot be retained
 * forever by a stalled transport or never-settling Promise.
 *
 * Five minutes is a conservative operational ceiling, not a normal
 * chunk-arrival budget, evidence of remote absence, or a transport deadline.
 * The transport contract cannot yet abort the underlying request when it fires.
 */
export declare const DEFAULT_CHUNK_DELIVERY_STALL_TIMEOUT_MS: number;
export type ActivityCountSource = Pick<ReactiveSource<number>, "value" | "onChanged" | "offChanged">;
export type ChunkDeliveryClaimOptions = {
    stallTimeoutMs?: number;
    onStalled?: (ids: readonly DocumentID[]) => void;
};
export type ChunkDeliveryChangeListener = (ids?: readonly DocumentID[]) => void;
/** A finite claim that keeps chunk arrival waiters paused until every owned identifier settles. */
export interface ChunkDeliveryClaim {
    readonly done: Promise<void>;
    readonly pendingIds: readonly DocumentID[];
    release(): void;
    settle(id: DocumentID): void;
    touch(): void;
}
/**
 * Coordinates on-demand chunk ownership with broader finite remote activity.
 *
 * `ChunkFetcher` owns claims. `ArrivalWaitLayer` observes only whether an
 * identifier may still be delivered, so it does not depend on a replicator
 * service or on fetch scheduling details.
 */
export declare class ChunkDeliveryCoordinator {
    private readonly finiteReplicationActivity?;
    private readonly activeClaimCounts;
    private readonly claimReleases;
    private readonly listeners;
    private finiteActivityWasActive;
    private readonly finiteActivityChanged;
    private disposed;
    constructor(finiteReplicationActivity?: ActivityCountSource | undefined);
    claim(ids: readonly DocumentID[], options?: ChunkDeliveryClaimOptions): ChunkDeliveryClaim;
    isActivityActiveFor(id: DocumentID): boolean;
    isClaimActiveFor(id: DocumentID): boolean;
    isFiniteReplicationActive(): boolean;
    onChanged(listener: ChunkDeliveryChangeListener): () => void;
    dispose(): void;
    private notifyChanged;
}
