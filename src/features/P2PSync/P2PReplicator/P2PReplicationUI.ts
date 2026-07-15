import type { App } from "@/deps.ts";
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
                let resolved = false;
                let sessionResult = false;
                let activeSynchronisations = 0;
                let closed = false;
                const safeResolve = () => {
                    if (resolved) return;
                    resolved = true;
                    resolve(sessionResult);
                };
                const settleClosedSession = () => {
                    if (closed && activeSynchronisations === 0) safeResolve();
                };
                const synchronise = async (peerId: string, closeConnection: boolean) => {
                    activeSynchronisations++;
                    try {
                        // Pull first, then push only when the pull succeeds.
                        const pullResult = await replicator.replicateFrom(peerId, showResult);
                        if (!pullResult?.ok) {
                            sessionResult = false;
                            return;
                        }
                        const pushResult = await replicator.requestSynchroniseToPeer(peerId);
                        sessionResult = pushResult?.ok ?? true;
                        if (sessionResult && closeConnection) await replicator.close();
                    } catch (e) {
                        Logger(
                            `Error in bidirectional sync with ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
                            logLevel
                        );
                        sessionResult = false;
                    } finally {
                        activeSynchronisations--;
                        settleClosedSession();
                    }
                };
                const modal = new P2POpenReplicationModal(
                    app,
                    replicator,
                    {
                        onSync: (peerId: string) => synchronise(peerId, false),
                        onSyncAndClose: (peerId: string) => synchronise(peerId, true),
                    },
                    showResult,
                    "P2P Replication",
                    () => {
                        closed = true;
                        settleClosedSession();
                    }
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
                let activeSynchronisations = 0;
                let closed = false;
                let operationCompleted = false;
                let sessionResult = false;
                const safeResolve = (val: boolean) => {
                    if (!resolved) {
                        resolved = true;
                        resolve(val);
                    }
                };
                const settleSession = () => {
                    if (activeSynchronisations !== 0) return;
                    if (closed || operationCompleted) safeResolve(sessionResult);
                };

                const doRebuild = async (peerId: string) => {
                    activeSynchronisations++;
                    try {
                        replicator.setOnSetup();
                        Logger(`Rebuilding from peer ${peerId}`, logLevel);
                        const result = await replicator.replicateFrom(peerId, showResult);
                        sessionResult = result?.ok ?? false;
                    } catch (e) {
                        Logger(
                            `Error in rebuild from ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
                            logLevel
                        );
                        sessionResult = false;
                    } finally {
                        try {
                            replicator.clearOnSetup();
                        } finally {
                            operationCompleted = true;
                            activeSynchronisations--;
                            settleSession();
                        }
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
                    () => {
                        closed = true;
                        settleSession();
                    },
                    true
                );
                modal.open();
            });
        };
}
