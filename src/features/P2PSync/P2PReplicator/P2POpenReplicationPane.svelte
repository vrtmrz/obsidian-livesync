<script lang="ts">
    import { onMount } from "svelte";
    import { eventHub } from "@/common/events";
    import {
        EVENT_SERVER_STATUS,
        EVENT_REQUEST_STATUS,
        type P2PServerInfo,
    } from "@lib/replication/trystero/TrysteroReplicatorP2PServer";
    // import type { TrysteroReplicator } from "@lib/replication/trystero/TrysteroReplicator";
    import { LOG_LEVEL_NOTICE, LOG_LEVEL_INFO } from "@lib/common/types";
    import { Logger } from "@lib/common/logger";
    import type { LiveSyncTrysteroReplicator } from "@/lib/src/replication/trystero/LiveSyncTrysteroReplicator";
    import { delay, fireAndForget } from "octagonal-wheels/promises";
    import P2PServerStatusCard from "./P2PServerStatusCard.svelte";

    interface Props {
        liveSyncReplicator: LiveSyncTrysteroReplicator;
        onSync: (_peerId: string) => Promise<void>;
        onSyncAndClose: (_peerId: string) => Promise<void>;
        onClose: () => void;
        showResult: boolean;
    }

    let { onSync, onSyncAndClose, onClose, showResult, liveSyncReplicator }: Props = $props();

    let serverInfo = $state<P2PServerInfo | undefined>(undefined);
    let syncingPeerId = $state<string | null>(null);

    const logLevel = showResult ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO;
    async function requestServerStatus() {
        await liveSyncReplicator.requestStatus();
        eventHub.emitEvent(EVENT_REQUEST_STATUS);
    }
    onMount(() => {
        // ServerStatus
        const unsubscribe = eventHub.onEvent(EVENT_SERVER_STATUS, (status) => {
            serverInfo = status;
        });
        fireAndForget(async ()=>{
            await delay(100);
            await requestServerStatus();
        })
        return unsubscribe;
    });

    async function handleSync(peerId: string) {
        try {
            syncingPeerId = peerId;
            Logger(`Starting sync with ${peerId}`, logLevel);
            await onSync(peerId);
            Logger(`Sync completed with ${peerId}`, logLevel);
        } catch (e) {
            Logger(`Error during sync: ${e instanceof Error ? e.message : String(e)}`, logLevel);
        } finally {
            syncingPeerId = null;
        }
    }

    async function handleSyncAndClose(peerId: string) {
        fireAndForget(async () => {
            try {
                Logger(`Starting sync with ${peerId}`, logLevel);
                await onSync(peerId);
                Logger(`Sync completed with ${peerId}`, logLevel);
            } catch (e) {
                Logger(`Error during sync: ${e instanceof Error ? e.message : String(e)}`, logLevel);
            }
        });
        onClose();
    }
    async function disconnect(){
        try {
            await liveSyncReplicator.close();
            Logger("Signalling connection closed.", logLevel);
        } catch (e) {
            Logger(`Failed to close signalling connection: ${e instanceof Error ? e.message : String(e)}`, logLevel);
        }
    }
    async function onCloseAndDisconnect(){
        await disconnect();
        onClose();
    }

    function getAcceptanceStatus(peer: P2PServerInfo["knownAdvertisements"][number]) {
        if (peer.isTemporaryAccepted === true) return "ACCEPTED (in session)";
        if (peer.isAccepted === true) return "ACCEPTED";
        if (peer.isTemporaryAccepted === false) return "DENIED (in session)";
        if (peer.isAccepted === false) return "DENIED";
        return "NEW";
    }

    function getAcceptanceStatusClass(peer: P2PServerInfo["knownAdvertisements"][number]) {
        if (peer.isTemporaryAccepted === true || peer.isAccepted === true) return "accepted";
        if (peer.isTemporaryAccepted === false || peer.isAccepted === false) return "denied";
        return "unknown";
    }
</script>

<div class="p2p-container">
    <P2PServerStatusCard
        {liveSyncReplicator}
        showBroadcastToggle={false}
    />

    <div class="peers-section">
        <h3>Available Peers</h3>
        {#if serverInfo && serverInfo.knownAdvertisements.length > 0}
            <div class="peers-list">
                {#each serverInfo.knownAdvertisements as peer (peer.peerId)}
                    <div class="peer-item">
                        <div class="peer-info">
                            <div class="peer-name">{peer.name}</div>
                            <div class="peer-meta">
                                <span class="badge">{peer.platform}</span>
                                <span class="peer-id-mini" title={peer.peerId}>
                                    {peer.peerId.slice(0, 8)}
                                </span>
                                <span class="badge status-chip {getAcceptanceStatusClass(peer)}">
                                    {getAcceptanceStatus(peer)}
                                </span>
                            </div>
                        </div>
                        <div class="peer-actions">
                            <button
                                class="btn btn-primary"
                                disabled={syncingPeerId !== null}
                                onclick={() => handleSync(peer.peerId)}
                            >
                                {syncingPeerId === peer.peerId ? "Syncing..." : "Sync"}
                            </button>
                            <button
                                class="btn btn-secondary"
                                disabled={syncingPeerId !== null}
                                onclick={() => handleSyncAndClose(peer.peerId)}
                            >
                                Start Sync &amp; Close
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {:else if serverInfo}
            <p class="no-peers">No devices available. Waiting for other devices to connect...</p>
        {/if}
    </div>

    <div class="footer">
        <button class="btn btn-cancel" onclick={onClose}>Close</button>
        <button class="btn btn-cancel" onclick={onCloseAndDisconnect}>Close & Disconnect</button>
    </div>
</div>

<style>
    .p2p-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1rem;
        max-height: 70vh;
        overflow-y: auto;
    }

    .peers-section {
        border: 1px solid var(--divider-color);
        border-radius: 0.5rem;
        padding: 1rem;
    }

    h3 {
        margin: 0 0 0.75rem 0;
        font-weight: 600;
        font-size: 1rem;
    }

    .peers-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .peer-item {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        align-items: center;
        padding: 0.75rem;
        background-color: var(--background-secondary);
        border: 1px solid var(--divider-color);
        border-radius: 0.4rem;
    }

    .peer-info {
        flex: 1;
    }

    .peer-name {
        font-weight: 600;
        margin-bottom: 0.25rem;
    }

    .peer-meta {
        display: flex;
        gap: 0.5rem;
        font-size: 0.8rem;
    }

    .badge {
        background-color: var(--background-tertiary);
        padding: 0.1rem 0.4rem;
        border-radius: 0.25rem;
    }

    .status-chip {
        font-weight: 600;
    }

    .status-chip.accepted {
        background-color: var(--background-modifier-success);
        color: var(--text-normal);
    }

    .status-chip.denied {
        background-color: var(--background-modifier-error);
        color: var(--text-normal);
    }

    .status-chip.unknown {
        background-color: var(--background-modifier-border);
        color: var(--text-muted);
    }

    .peer-id-mini {
        font-family: monospace;
        color: var(--text-muted);
    }

    .peer-actions {
        flex-wrap: wrap;
        display: flex;
        gap: 0.5rem;
    }

    .btn {
        padding: 0.4rem 0.8rem;
        border: 1px solid var(--divider-color);
        border-radius: 0.3rem;
        background-color: var(--interactive-normal);
        color: var(--text-normal);
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: 500;
        transition: background-color 0.2s;
    }

    .btn:hover:not(:disabled) {
        background-color: var(--interactive-hover);
    }

    .btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .btn-primary {
        background-color: var(--interactive-accent);
        color: var(--text-on-accent);
    }

    .btn-secondary {
        background-color: var(--background-tertiary);
    }

    .btn-cancel {
        width: 100%;
        margin-top: 0.5rem;
    }

    .no-peers {
        text-align: center;
        color: var(--text-muted);
        font-size: 0.9rem;
        padding: 1rem;
    }

    .footer {
        border-top: 1px solid var(--divider-color);
        padding-top: 0.75rem;
    }
</style>
