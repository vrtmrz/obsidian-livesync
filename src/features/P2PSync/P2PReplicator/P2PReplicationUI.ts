import type { App } from "@/deps.ts";
import { Logger } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { LOG_LEVEL_NOTICE, LOG_LEVEL_INFO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncTrysteroReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/LiveSyncTrysteroReplicator";
import type { P2PServiceViews } from "@vrtmrz/livesync-commonlib/p2p";
import { P2POpenReplicationModal } from "./P2POpenReplicationModal";

/**
 * Create the Obsidian-owned interactive P2P entry for stable service views.
 *
 * Peer selection belongs to the host UI rather than the concrete compatibility
 * Replicator. The returned operation opens the modal and performs bidirectional
 * synchronisation, pulling before pushing, through the targeted-transfer view.
 *
 * Usage:
 *   const createInteractiveReplication = createOpenReplicationUI(app);
 *   const openInteractiveReplication = createInteractiveReplication(p2p);
 */
export function createOpenReplicationUI(
    app: App
): (p2p: P2PServiceViews) => (showResult: boolean) => Promise<boolean | void> {
    return (p2p: P2PServiceViews) =>
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
                        const pullResult = await p2p.targetedTransfer.pullFromPeer(peerId, {
                            showNotice: showResult,
                        });
                        if (pullResult.status !== "completed" || !pullResult.ok) {
                            sessionResult = false;
                            return false;
                        }
                        const pushResult = await p2p.targetedTransfer.requestPushToPeer(peerId);
                        const completed = pushResult.status === "completed" && pushResult.ok === true;
                        sessionResult = completed;
                        if (completed && closeConnection) await p2p.transportLifecycle.disconnect();
                        return completed;
                    } catch (e) {
                        Logger(
                            `Error in bidirectional sync with ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
                            logLevel
                        );
                        sessionResult = false;
                        return false;
                    } finally {
                        activeSynchronisations--;
                        settleClosedSession();
                    }
                };
                const modal = new P2POpenReplicationModal(
                    app,
                    p2p,
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
 *   useP2PReplicatorFeature(core, openReplicationUIFactory, factory);
 */
export function createOpenRebuildUI(
    app: App
): (replicator: LiveSyncTrysteroReplicator, p2p: P2PServiceViews) => (showResult: boolean) => Promise<boolean | void> {
    return (replicator: LiveSyncTrysteroReplicator, p2p: P2PServiceViews) =>
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
                        const result = await replicator.replicateFrom(peerId, showResult, true);
                        sessionResult = result?.ok ?? false;
                        return sessionResult;
                    } catch (e) {
                        Logger(
                            `Error in rebuild from ${peerId}: ${e instanceof Error ? e.message : String(e)}`,
                            logLevel
                        );
                        sessionResult = false;
                        return false;
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
                    p2p,
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
