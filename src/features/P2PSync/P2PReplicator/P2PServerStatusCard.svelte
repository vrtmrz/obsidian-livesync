<script lang="ts">
    import { onMount } from "svelte";
    import { eventHub } from "@/common/events";
    import { delay, fireAndForget } from "octagonal-wheels/promises";
    import type { P2PServerInfo } from "@lib/replication/trystero/TrysteroReplicatorP2PServer";
    import {
        EVENT_SERVER_STATUS,
        EVENT_REQUEST_STATUS,
        EVENT_P2P_REPLICATOR_STATUS,
    } from "@lib/replication/trystero/TrysteroReplicatorP2PServer";
    import type { LiveSyncTrysteroReplicator } from "@/lib/src/replication/trystero/LiveSyncTrysteroReplicator";
    import type { P2PReplicatorStatus } from "@/lib/src/replication/trystero/TrysteroReplicator";

    interface Props {
        liveSyncReplicator: LiveSyncTrysteroReplicator;
        showBroadcastToggle?: boolean;
    }

    let { liveSyncReplicator, showBroadcastToggle = true }: Props = $props();
    let serverInfo = $state<P2PServerInfo | undefined>(undefined);
    let replicatorStatus = $state<P2PReplicatorStatus | undefined>(undefined);

    async function requestServerStatus() {
        await Promise.resolve(liveSyncReplicator.requestStatus());
        eventHub.emitEvent(EVENT_REQUEST_STATUS);
    }

    async function onOpenConnection() {
        await liveSyncReplicator.makeSureOpened();
        await requestServerStatus();
    }

    async function onDisconnect() {
        await liveSyncReplicator.close();
        await requestServerStatus();
    }

    function toggleBroadcast() {
        if (replicatorStatus?.isBroadcasting) {
            liveSyncReplicator.disableBroadcastChanges();
        } else {
            liveSyncReplicator.enableBroadcastChanges();
        }
    }

    onMount(() => {
        const unsubscribe = eventHub.onEvent(EVENT_SERVER_STATUS, (status) => {
            serverInfo = status;
        });
        const unsubscribeStatus = eventHub.onEvent(EVENT_P2P_REPLICATOR_STATUS, (status) => {
            replicatorStatus = status;
        });

        fireAndForget(async () => {
            await delay(100);
            await requestServerStatus();
        });

        return () => {
            unsubscribe();
            unsubscribeStatus();
        };
    });

    const isConnected = $derived.by(() => serverInfo?.isConnected);
    const isBroadcasting = $derived.by(() => replicatorStatus?.isBroadcasting ?? false);
</script>

<div class="server-status">
    <h3>Signalling Status</h3>

    <div class="status-item">
        <span>Connection:</span>
        <span class="status-value {isConnected ? 'connected' : 'disconnected'}">
            {isConnected ? "🟢 Connected" : "🔴 Disconnected"}
        </span>
    </div>

    <div class="status-item status-action">
        {#if !isConnected}
            <button onclick={onOpenConnection}>Open connection</button>
        {:else}
            <button onclick={onDisconnect}>Close connection</button>
        {/if}
    </div>

    {#if serverInfo}
        <div class="status-item">
            <span>Peer ID:</span>
            <span class="peer-id-display" title={serverInfo.serverPeerId}>
                {serverInfo.serverPeerId.slice(0, 12)}...
            </span>
        </div>

        <div class="status-item">
            <span>Devices:</span>
            <span>{serverInfo.knownAdvertisements.length}</span>
        </div>
    {/if}

    {#if showBroadcastToggle}
    <div class="status-item status-action broadcast-row">
        <!-- Live-push to peers: stream this device's changes to connected peers for LiveSync -->
        <label class="broadcast-label" for="broadcast-toggle">
            Live-push to peers
        </label>
        <button
            id="broadcast-toggle"
            class="broadcast-button {isBroadcasting ? 'is-on' : 'is-off'}"
            onclick={toggleBroadcast}
            title={isBroadcasting ? 'Pushing changes to peers — click to stop' : 'Start pushing changes to peers'}
        >
            {isBroadcasting ? '📡 On' : '📡 Off'}
        </button>
    </div>
    {/if}
</div>

<style>
    .server-status {
        border: 1px solid var(--divider-color);
        border-radius: 0.5rem;
        padding: 1rem;
    }

    h3 {
        margin: 0 0 0.75rem 0;
        font-weight: 600;
        font-size: 1rem;
    }

    .status-item {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        font-size: 0.9rem;
        margin-bottom: 0.5rem;
    }

    .status-action {
        align-items: center;
        gap: 0.5rem;
    }

    .status-value {
        font-weight: 500;
    }

    .status-value.connected {
        color: var(--text-success);
    }

    .status-value.disconnected {
        color: var(--text-error);
    }

    .peer-id-display {
        font-family: monospace;
        font-size: 0.85rem;
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .broadcast-row {
        align-items: center;
        margin-top: 0.25rem;
    }

    .broadcast-label {
        font-size: 0.9rem;
        color: var(--text-normal);
        cursor: pointer;
    }

    .broadcast-button {
        font-size: 0.8rem;
        padding: 0.2rem 0.6rem;
        border: 1px solid var(--divider-color);
        border-radius: 0.4rem;
        cursor: pointer;
        font-weight: 600;
        transition: background-color 0.15s;
    }

    .broadcast-button.is-on {
        background-color: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
    }

    .broadcast-button.is-off {
        background-color: var(--interactive-normal);
        color: var(--text-muted);
    }

    .broadcast-button.is-off:hover {
        background-color: var(--interactive-hover);
        color: var(--text-normal);
    }
</style>