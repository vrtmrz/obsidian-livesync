// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import { type RemoteDBSettings } from "@lib/common/types";
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import type { NecessaryObsidianFeature } from "@/types";
type CouchDBReplicatorHost = NecessaryObsidianFeature<"replicator" | "appLifecycle" | "replication" | "setting">;
export declare const createCouchDBReplicatorHandler: (host: CouchDBReplicatorHost, settingOverride?: Partial<RemoteDBSettings>) => Promise<LiveSyncAbstractReplicator | false>;
export declare const resumeCouchDBReplicationHandler: (host: CouchDBReplicatorHost) => Promise<boolean>;
export declare function useCouchDBReplicatorFactory(host: CouchDBReplicatorHost): void;
type MinIOReplicatorHost = NecessaryObsidianFeature<"replicator" | "setting">;
export declare const createMinIOReplicatorHandler: (host: MinIOReplicatorHost, settingOverride?: Partial<RemoteDBSettings>) => Promise<LiveSyncAbstractReplicator | false>;
export declare function useMinIOReplicatorFactory(host: MinIOReplicatorHost): void;
export {};
