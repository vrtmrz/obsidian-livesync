// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { LiveSyncTrysteroReplicator } from "./LiveSyncTrysteroReplicator";
import { type UseP2PReplicatorResult } from "./UseP2PReplicatorResult";
/**
 * Factory type: given a replicator instance, returns the openReplicationUI callback for that instance.
 * Injected by the host platform (e.g. Obsidian). CLI/headless environments omit this.
 */
export type OpenReplicationUIFactory = (replicator: LiveSyncTrysteroReplicator) => (showResult: boolean) => Promise<boolean | void>;
/** Same shape as OpenReplicationUIFactory, used for the rebuild/replicateAllFromServer flow. */
export type OpenRebuildUIFactory = OpenReplicationUIFactory;
/**
 * ServiceFeature: P2P Replicator integration and lifecycle management.
 * Registers a LiveSyncTrysteroReplicator instance as the active replicator when P2P is enabled in settings,
 * and binds it to lifecycle events for proper initialization and cleanup.
 * @param host
 */
export declare function useP2PReplicatorFeature(host: NecessaryServices<"API" | "appLifecycle" | "setting" | "vault" | "database" | "databaseEvents" | "keyValueDB" | "replication" | "config" | "UI" | "replicator" | "remote", never>, openReplicationUIFactory?: OpenReplicationUIFactory, openRebuildUIFactory?: OpenRebuildUIFactory): UseP2PReplicatorResult;
