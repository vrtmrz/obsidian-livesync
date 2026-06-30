// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import type { UseP2PReplicatorResult } from "./UseP2PReplicatorResult";
/**
 * ServiceFeature: Registers event handlers for P2P replication and manages the lifecycle of a LiveSyncTrysteroReplicator instance.
 * @param host
 */
export declare function useP2PReplicatorCommands(host: NecessaryServices<"API" | "setting", never>, { replicator }: UseP2PReplicatorResult): void;
