<script lang="ts">
    import { onMount } from "svelte";
    import { EVENT_REQUEST_OPEN_P2P_SETTINGS, eventHub } from "@/common/events";
    import {
        EVENT_SERVER_STATUS,
        EVENT_REQUEST_STATUS,
        EVENT_P2P_REPLICATOR_STATUS,
        EVENT_P2P_REPLICATOR_PROGRESS,
        type P2PServerInfo,
    } from "@lib/replication/trystero/TrysteroReplicatorP2PServer";
    import type { LiveSyncTrysteroReplicator } from "@/lib/src/replication/trystero/LiveSyncTrysteroReplicator";
    import type { P2PReplicatorStatus, P2PReplicationReport } from "@/lib/src/replication/trystero/TrysteroReplicator";
    import { delay, fireAndForget } from "octagonal-wheels/promises";
    import P2PServerStatusCard from "./P2PServerStatusCard.svelte";
    import { EVENT_SETTING_SAVED } from "@lib/events/coreEvents";
    import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";

    interface Props {
        liveSyncReplicator: LiveSyncTrysteroReplicator;
        core: LiveSyncBaseCore;
    }

    let { liveSyncReplicator, core }: Props = $props();
    let serverInfo = $state<P2PServerInfo | undefined>(undefined);
    let replicatorInfo = $state<P2PReplicatorStatus | undefined>(undefined);
    let decidingPeerId = $state<string | null>(null);
    let communicatingUntil = $state<Record<string, number>>({});
    const COMMUNICATION_HOLD_MS = 2500;
    let syncOnReplicationSetting = $state(
        core.services.setting.currentSettings()?.P2P_SyncOnReplication ?? ""
    );

    function addToList(item: string, list: string): string {
        const items = list.split(",").map((e) => e.trim()).filter((e) => e);
        if (!items.includes(item)) items.push(item);
        return items.join(",");
    }
    function removeFromList(item: string, list: string): string {
        return list.split(",").map((e) => e.trim()).filter((e) => e && e !== item).join(",");
    }

    function markCommunicating(peerId: string) {
        const expiry = Date.now() + COMMUNICATION_HOLD_MS;
        communicatingUntil = { ...communicatingUntil, [peerId]: expiry };
        window.setTimeout(() => {
            if ((communicatingUntil[peerId] ?? 0) <= Date.now()) {
                const { [peerId]: _removed, ...rest } = communicatingUntil;
                communicatingUntil = rest;
            }
        }, COMMUNICATION_HOLD_MS + 100);
    }

    async function requestServerStatus() {
        await liveSyncReplicator.requestStatus();
        eventHub.emitEvent(EVENT_REQUEST_STATUS);
    }

    onMount(() => {
        const unsubscribe = eventHub.onEvent(EVENT_SERVER_STATUS, (status) => {
            serverInfo = status;
        });
        const unsubscribeReplicatorStatus = eventHub.onEvent(EVENT_P2P_REPLICATOR_STATUS, (status) => {
            replicatorInfo = status;
            for (const peerId of status.replicatingFrom) {
                markCommunicating(peerId);
            }
            for (const peerId of status.replicatingTo) {
                markCommunicating(peerId);
            }
        });
        const unsubscribeReplicatorProgress = eventHub.onEvent(EVENT_P2P_REPLICATOR_PROGRESS, (report) => {
            const rep = report as P2PReplicationReport;
            if (("fetching" in rep && rep.fetching?.isActive) || ("sending" in rep && rep.sending?.isActive)) {
                markCommunicating(rep.peerId);
            }
        });

        const unsubscribeSettings = eventHub.onEvent(EVENT_SETTING_SAVED, (settings) => {
            syncOnReplicationSetting = settings?.P2P_SyncOnReplication ?? "";
        });

        fireAndForget(async () => {
            await delay(100);
            await requestServerStatus();
        });

        return () => {
            unsubscribe();
            unsubscribeReplicatorStatus();
            unsubscribeReplicatorProgress();
            unsubscribeSettings();
        };
    });

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

    function openConnectionSettings() {
        eventHub.emitEvent(EVENT_REQUEST_OPEN_P2P_SETTINGS);
    }

    async function makeDecision(
        peer: P2PServerInfo["knownAdvertisements"][number],
        decision: boolean,
        isTemporary: boolean
    ) {
        decidingPeerId = peer.peerId;
        try {
            await liveSyncReplicator.makeDecision({
                peerId: peer.peerId,
                name: peer.name,
                decision,
                isTemporary,
            });
            await requestServerStatus();
        } finally {
            decidingPeerId = null;
        }
    }

    async function revokeDecision(peer: P2PServerInfo["knownAdvertisements"][number]) {
        decidingPeerId = peer.peerId;
        try {
            await liveSyncReplicator.revokeDecision({
                peerId: peer.peerId,
                name: peer.name,
            });
            await requestServerStatus();
        } finally {
            decidingPeerId = null;
        }
    }

    function isAccepted(peer: P2PServerInfo["knownAdvertisements"][number]) {
        return peer.isTemporaryAccepted === true || peer.isAccepted === true;
    }

    function isWatching(peerId: string) {
        return replicatorInfo?.watchingPeers?.includes(peerId) ?? false;
    }

    function toggleWatch(peerId: string) {
        if (isWatching(peerId)) {
            liveSyncReplicator.unwatchPeer(peerId);
        } else {
            liveSyncReplicator.watchPeer(peerId);
        }
    }

    function isCommunicating(peerId: string) {
        const to = replicatorInfo?.replicatingTo ?? [];
        const from = replicatorInfo?.replicatingFrom ?? [];
        const isLiveCommunicating = to.includes(peerId) || from.includes(peerId);
        const isHeldCommunicating = (communicatingUntil[peerId] ?? 0) > Date.now();
        return isLiveCommunicating || isHeldCommunicating;
    }

    function isSyncTarget(peerName: string) {
        return syncOnReplicationSetting
            .split(",")
            .map((e) => e.trim())
            .filter((e) => e)
            .includes(peerName);
    }

    async function toggleSyncTarget(peer: P2PServerInfo["knownAdvertisements"][number]) {
        const currentValue = core.services.setting.currentSettings()?.P2P_SyncOnReplication ?? "";
        const newValue = isSyncTarget(peer.name)
            ? removeFromList(peer.name, currentValue)
            : addToList(peer.name, currentValue);
        await core.services.setting.applyPartial({ P2P_SyncOnReplication: newValue }, true);
    }
</script>

<div class="p2p-container">
    <div class="pane-header">
        <h2>P2P Status</h2>
        <button
            class="icon-button"
            onclick={openConnectionSettings}
            title="Open P2P Setup..."
            aria-label="Open P2P Setup..."
        >
            ⚙
        </button>
    </div>

    <P2PServerStatusCard {liveSyncReplicator} />

    <div class="peers-section">
        <div class="peers-header">
            <h3>Detected Peers</h3>
            <button class="refresh" onclick={requestServerStatus}>Refresh</button>
        </div>

        {#if serverInfo && serverInfo.knownAdvertisements.length > 0}
            <div class="peers-list">
                {#each serverInfo.knownAdvertisements as peer (peer.peerId)}
                    <div class="peer-item">
                        <div class="peer-info">
                            <div class="peer-name">
                                {peer.name} : <span class="peer-id-mini" title={peer.peerId}>({peer.peerId.slice(0, 8)})</span>
                                {#if isCommunicating(peer.peerId)}
                                    <span class="comm-icon" title="Communicating" aria-label="Communicating">📡</span>
                                {/if}
                            </div>
                            <div class="peer-meta">
                                <span class="badge">{peer.platform}</span>
                            </div>
                        </div>
                        <div class="peer-actions">
                            {#if isAccepted(peer)}
                                <div class="decision-row accepted-row">
                                    <span class="badge status-chip {getAcceptanceStatusClass(peer)}">
                                        {getAcceptanceStatus(peer)}
                                    </span>
                                    <button
                                        class="action-button"
                                        disabled={decidingPeerId !== null}
                                        onclick={() => revokeDecision(peer)}
                                    >
                                        Revoke
                                    </button>
                                </div>
                                <div class="decision-row watch-row">
                                    <span class="decision-label">WATCH</span>
                                    <button
                                        class="emoji-button {isWatching(peer.peerId) ? 'is-watching' : ''}"
                                        title={isWatching(peer.peerId) ? 'Watching this peer \u2014 click to stop' : 'Watch this peer\'s changes'}
                                        aria-label={isWatching(peer.peerId) ? 'Stop watching' : 'Watch peer'}
                                        onclick={() => toggleWatch(peer.peerId)}
                                    >
                                        {isWatching(peer.peerId) ? '👁' : '👁‍🗨'}
                                    </button>
                                </div>                                <div class="decision-row watch-row">
                                    <span class="decision-label">SYNC</span>
                                    <button
                                        class="emoji-button {isSyncTarget(peer.name) ? 'is-watching' : ''}"
                                        title={isSyncTarget(peer.name) ? 'Sync target \u2014 click to remove' : 'Set as sync target'}
                                        aria-label={isSyncTarget(peer.name) ? 'Remove sync target' : 'Set sync target'}
                                        onclick={() => toggleSyncTarget(peer)}
                                    >
                                        {isSyncTarget(peer.name) ? '🔄' : '🔁'}
                                    </button>
                                </div>                            {:else}
                                <div class="decision-status">
                                    <span class="badge status-chip {getAcceptanceStatusClass(peer)}">
                                        {getAcceptanceStatus(peer)}
                                    </span>
                                </div>
                                <div class="decision-row">
                                    <span class="decision-label">PERMANENT</span>
                                    <button
                                        class="emoji-button"
                                        title="Allow permanently"
                                        aria-label="Allow permanently"
                                        disabled={decidingPeerId !== null}
                                        onclick={() => makeDecision(peer, true, false)}
                                    >
                                        ✅
                                    </button>
                                    <button
                                        class="emoji-button mod-warning"
                                        title="Deny permanently"
                                        aria-label="Deny permanently"
                                        disabled={decidingPeerId !== null}
                                        onclick={() => makeDecision(peer, false, false)}
                                    >
                                        🚫
                                    </button>
                                </div>
                                <div class="decision-row">
                                    <span class="decision-label">SESSION</span>
                                    <button
                                        class="emoji-button"
                                        title="Allow in session"
                                        aria-label="Allow in session"
                                        disabled={decidingPeerId !== null}
                                        onclick={() => makeDecision(peer, true, true)}
                                    >
                                        ✅
                                    </button>
                                    <button
                                        class="emoji-button mod-warning"
                                        title="Deny in session"
                                        aria-label="Deny in session"
                                        disabled={decidingPeerId !== null}
                                        onclick={() => makeDecision(peer, false, true)}
                                    >
                                        🚫
                                    </button>
                                </div>
                            {/if}
                            {#if !isAccepted(peer) && (peer.isAccepted !== undefined || peer.isTemporaryAccepted !== undefined)}
                                <button
                                    class="action-button revoke-inline"
                                    disabled={decidingPeerId !== null}
                                    onclick={() => revokeDecision(peer)}
                                >
                                    Revoke
                                </button>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        {:else if serverInfo}
            <p class="no-peers">No devices available. Waiting for other devices to connect...</p>
        {:else}
            <p class="no-peers">Fetching status...</p>
        {/if}
    </div>
</div>

<style>
    .p2p-container {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 0.75rem;
    }

    .peers-section {
        border: 1px solid var(--divider-color);
        border-radius: 0.5rem;
        padding: 1rem;
    }

    .pane-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: nowrap;
        gap: 0.5rem;
    }

    .pane-header h2 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 700;
        white-space: nowrap;
    }

    .icon-button {
        width: 1.9rem;
        height: 1.9rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        line-height: 1;
        border: 1px solid var(--divider-color);
        border-radius: 0.4rem;
        background-color: var(--interactive-normal);
        color: var(--text-normal);
        cursor: pointer;
        flex-shrink: 0;
    }

    .icon-button:hover {
        background-color: var(--interactive-hover);
    }

    .peers-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
    }

    h3 {
        margin: 0;
        font-weight: 600;
        font-size: 1rem;
    }

    .refresh {
        font-size: 0.8rem;
        padding: 0.2rem 0.5rem;
        border: 1px solid var(--divider-color);
        border-radius: 0.3rem;
        background-color: var(--interactive-normal);
        color: var(--text-normal);
        cursor: pointer;
    }

    .refresh:hover {
        background-color: var(--interactive-hover);
    }

    .peers-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .peer-item {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 0.75rem;
        padding: 0.75rem;
        background-color: var(--background-secondary);
        border: 1px solid var(--divider-color);
        border-radius: 0.4rem;
    }

    .peer-info {
        flex: 1;
        min-width: 0;
    }

    .peer-name {
        font-weight: 600;
        margin-bottom: 0.25rem;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 0.35rem;
    }

    .peer-meta {
        display: flex;
        gap: 0.5rem;
        font-size: 0.8rem;
        flex-wrap: wrap;
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
        font-size: 0.75rem;
    }

    .comm-icon {
        font-size: 0.8rem;
        line-height: 1;
        animation: pulse-comm 1.2s ease-in-out infinite;
    }

    @keyframes pulse-comm {
        0% {
            opacity: 0.55;
            transform: scale(0.95);
        }
        50% {
            opacity: 1;
            transform: scale(1);
        }
        100% {
            opacity: 0.55;
            transform: scale(0.95);
        }
    }

    .peer-actions {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        width: 100%;
        min-width: 0;
    }

    .decision-status {
        display: flex;
        justify-content: flex-start;
    }

    .decision-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 0.35rem;
    }

    .accepted-row {
        grid-template-columns: 1fr auto;
    }

    .decision-label {
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--text-muted);
        letter-spacing: 0.03em;
    }

    .action-button {
        font-size: 0.75rem;
        padding: 0.2rem 0.45rem;
        border: 1px solid var(--divider-color);
        border-radius: 0.3rem;
        background-color: var(--interactive-normal);
        color: var(--text-normal);
        cursor: pointer;
        width: auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .emoji-button {
        width: 2rem;
        height: 1.7rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--divider-color);
        border-radius: 0.3rem;
        background-color: var(--interactive-normal);
        cursor: pointer;
        padding: 0;
        line-height: 1;
    }

    .emoji-button.mod-warning {
        background-color: var(--background-modifier-error);
    }

    .emoji-button.is-watching {
        background-color: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
    }

    .emoji-button:hover:not(:disabled) {
        background-color: var(--interactive-hover);
    }

    .emoji-button.mod-warning:hover:not(:disabled) {
        filter: brightness(0.95);
    }

    .watch-row {
        margin-top: 0.25rem;
    }

    .action-button:hover:not(:disabled) {
        background-color: var(--interactive-hover);
    }

    .action-button.mod-warning {
        background-color: var(--background-modifier-error);
    }

    .action-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .emoji-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .revoke-inline {
        justify-self: start;
    }

    .no-peers {
        text-align: center;
        color: var(--text-muted);
        font-size: 0.9rem;
        padding: 1rem;
    }

</style>