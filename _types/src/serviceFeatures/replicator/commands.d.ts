// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule.ts";
export type ReplicatorFeatureHost = NecessaryServices<"API" | "replication" | "replicator", never>;
export declare function registerReplicatorCommands(host: ReplicatorFeatureHost): void;
