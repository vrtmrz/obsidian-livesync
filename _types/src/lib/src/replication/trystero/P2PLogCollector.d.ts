// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: ef1bdf0
import type { P2PReplicationProgress } from "./TrysteroReplicator";
export declare class P2PLogCollector {
    constructor();
    p2pReplicationResult: Map<string, P2PReplicationProgress>;
    updateP2PReplicationLine(): void;
    p2pReplicationLine: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<string>;
}
