// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: bbf2539
import type { DocumentID, EntryLeaf } from "@lib/common/types";
import type { IReadLayer } from "./ChunkLayerInterfaces";
import type { ChunkReadOptions } from "./types.ts";
import { ChunkDeliveryCoordinator } from "@lib/managers/ChunkDeliveryCoordinator.ts";
export type ChunkAvailabilityRecheck = (ids: readonly DocumentID[]) => Promise<readonly (EntryLeaf | false)[]>;
/**
 * Waits only for a delivery lifecycle which is already observable when the
 * local miss is handled. It does not guess at an arrival delay.
 */
export declare class ArrivalWaitLayer implements IReadLayer {
    private readonly recheckAvailability?;
    private readonly waitingMap;
    private readonly eventEmitter;
    private readonly deliveryCoordinator;
    private readonly ownsDeliveryCoordinator;
    private readonly stopObservingActivity;
    constructor(eventEmitter: (eventName: string, data: DocumentID[]) => void, deliveryCoordinator?: ChunkDeliveryCoordinator, recheckAvailability?: ChunkAvailabilityRecheck | undefined);
    private enqueueWaiting;
    private settle;
    private settleAfterObservedActivity;
    private refreshActivity;
    /** Handle a chunk document becoming available. */
    onChunkArrived(doc: EntryLeaf, deleted?: boolean): void;
    /** Handle an explicit remote-missing result. */
    onMissingChunk(id: DocumentID): void;
    read(ids: DocumentID[], options: ChunkReadOptions, next: (remaining: DocumentID[]) => Promise<(EntryLeaf | false)[]>): Promise<(EntryLeaf | false)[]>;
    clearWaiting(): void;
    tearDown(): void;
    getWaitingCount(): number;
}
