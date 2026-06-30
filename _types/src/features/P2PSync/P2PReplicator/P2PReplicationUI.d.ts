// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { App } from "@/deps.ts";
import type { LiveSyncTrysteroReplicator } from "@lib/replication/trystero/LiveSyncTrysteroReplicator";
/**
 * Creates an openReplicationUI factory for Obsidian environments.
 * Returns a per-replicator closure that opens the P2P Replication modal
 * and performs bidirectional sync (pull then push on success).
 *
 * Usage:
 *   const factory = createOpenReplicationUI(app);
 *   useP2PReplicatorFeature(core, factory);
 */
export declare function createOpenReplicationUI(app: App): (replicator: LiveSyncTrysteroReplicator) => (showResult: boolean) => Promise<boolean | void>;
/**
 * Creates an openRebuildUI factory for Obsidian environments.
 * Opens the P2P Replication modal in "rebuild" mode — one-way pull only,
 * with setOnSetup / clearOnSetup bracketing the replicateFrom call.
 *
 * Usage:
 *   const factory = createOpenRebuildUI(app);
 *   useP2PReplicatorFeature(core, createOpenReplicationUI(app), factory);
 */
export declare function createOpenRebuildUI(app: App): (replicator: LiveSyncTrysteroReplicator) => (showResult: boolean) => Promise<boolean | void>;
