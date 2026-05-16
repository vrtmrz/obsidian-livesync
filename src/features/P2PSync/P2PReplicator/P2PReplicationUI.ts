import { App } from "@/deps.ts";
import { Logger } from "@lib/common/logger";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_INFO } from "@lib/common/types";
import type { LiveSyncTrysteroReplicator } from "@lib/replication/trystero/LiveSyncTrysteroReplicator";
import { P2POpenReplicationModal } from "./P2POpenReplicationModal";

/**
 * Creates an openReplicationUI factory for Obsidian environments.
 * Returns a per-replicator closure that opens the P2P Replication modal
 * and performs bidirectional sync (pull then push on success).
 *
 * Usage:
 *   const factory = createOpenReplicationUI(app);
 *   useP2PReplicatorFeature(core, factory);
 */
export function createOpenReplicationUI(
    app: App
): (replicator: LiveSyncTrysteroReplicator) => (showResult: boolean) => Promise<boolean | void> {
    return (replicator: LiveSyncTrysteroReplicator) =>
        (showResult: boolean): Promise<boolean | void> => {
            const logLevel = showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
            return new Promise<boolean | void>((resolve) => {
                const modal = new P2POpenReplicationModal(
                    app,
                    replicator,
                    {
                        onSync: async (peerId: string) => {
                            try {
                                // pull (replicateFrom) first; push only on success
                                const pullResult = await replicator.replicateFrom(peerId, showResult);
                                if (pullResult?.ok) {
                                    const pushResult = await replicator.requestSynchroniseToPeer(peerId);
                                    resolve(pushResult?.ok ?? true);
                                } else {
                                    resolve(false);
                                }
                            } catch (e) {
                                Logger(
                                    `Error in bidirectional sync with ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
                                    logLevel
                                );
                                resolve(false);
                            }
                        },
                        onSyncAndClose: async (peerId: string) => {
                            try {
                                const pullResult = await replicator.replicateFrom(peerId, showResult);
                                if (pullResult?.ok) {
                                    const pushResult = await replicator.requestSynchroniseToPeer(peerId);
                                    if (pushResult?.ok ?? true) {
                                        await replicator.close();
                                        resolve(true);
                                    } else {
                                        resolve(false);
                                    }
                                } else {
                                    resolve(false);
                                }
                            } catch (e) {
                                Logger(
                                    `Error in bidirectional sync with ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
                                    logLevel
                                );
                                resolve(false);
                            }
                        },
                    },
                    showResult
                );
                modal.open();
            });
        };
}

/**
 * Creates an openRebuildUI factory for Obsidian environments.
 * Opens the P2P Replication modal in "rebuild" mode — one-way pull only,
 * with setOnSetup / clearOnSetup bracketing the replicateFrom call.
 *
 * Usage:
 *   const factory = createOpenRebuildUI(app);
 *   useP2PReplicatorFeature(core, createOpenReplicationUI(app), factory);
 */
export function createOpenRebuildUI(
    app: App
): (replicator: LiveSyncTrysteroReplicator) => (showResult: boolean) => Promise<boolean | void> {
    return (replicator: LiveSyncTrysteroReplicator) =>
        (showResult: boolean): Promise<boolean | void> => {
            const logLevel = showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
            return new Promise<boolean | void>((resolve) => {
                let resolved = false;
                const safeResolve = (val: boolean) => {
                    if (!resolved) {
                        resolved = true;
                        resolve(val);
                    }
                };

                const doRebuild = async (peerId: string) => {
                    replicator.setOnSetup();
                    try {
                        Logger(`Rebuilding from peer ${peerId}`, logLevel);
                        const result = await replicator.replicateFrom(peerId, showResult);
                        safeResolve(result?.ok ?? false);
                    } catch (e) {
                        Logger(
                            `Error in rebuild from ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
                            logLevel
                        );
                        safeResolve(false);
                    } finally {
                        replicator.clearOnSetup();
                    }
                };

                const modal = new P2POpenReplicationModal(
                    app,
                    replicator,
                    {
                        onSync: doRebuild,
                        onSyncAndClose: doRebuild,
                    },
                    showResult,
                    "P2P Rebuild",
                    () => safeResolve(false),
                    true
                );
                modal.open();
            });
        };
}
