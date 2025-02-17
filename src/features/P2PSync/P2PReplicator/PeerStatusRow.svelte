<script lang="ts">
    import { getContext } from "svelte";
    import { AcceptedStatus, type PeerStatus } from "../../../lib/src/replication/trystero/P2PReplicatorPaneCommon";
    import type { P2PReplicator } from "../CmdP2PReplicator";
    import { eventHub } from "../../../common/events";
    import { EVENT_P2P_PEER_SHOW_EXTRA_MENU } from "../../../lib/src/replication/trystero/P2PReplicatorPaneCommon";

    interface Props {
        peerStatus: PeerStatus;
    }

    let { peerStatus }: Props = $props();
    let peer = $derived(peerStatus);

    function select<T extends string | number | symbol, U>(d: T, cond: Record<T, U>): U;
    function select<T extends string | number | symbol, U, V>(d: T, cond: Record<T, U>, def: V): U | V;
    function select<T extends string | number | symbol, U>(d: T, cond: Record<T, U>, def?: U): U | undefined {
        return d in cond ? cond[d] : def;
    }

    let statusChips = $derived.by(() =>
        [
            peer.isWatching ? ["WATCHING"] : [],
            peer.isFetching ? ["FETCHING"] : [],
            peer.isSending ? ["SENDING"] : [],
        ].flat()
    );
    let acceptedStatusChip = $derived.by(() =>
        select(
            peer.accepted.toString(),
            {
                [AcceptedStatus.ACCEPTED]: "ACCEPTED",
                [AcceptedStatus.ACCEPTED_IN_SESSION]: "ACCEPTED (in session)",
                [AcceptedStatus.DENIED_IN_SESSION]: "DENIED (in session)",
                [AcceptedStatus.DENIED]: "DENIED",
                [AcceptedStatus.UNKNOWN]: "NEW",
            },
            ""
        )
    );
    const classList = {
        ["SENDING"]: "connected",
        ["FETCHING"]: "connected",
        ["WATCHING"]: "connected-live",
        ["WAITING"]: "waiting",
        ["ACCEPTED"]: "accepted",
        ["DENIED"]: "denied",
        ["NEW"]: "unknown",
    };
    let isAccepted = $derived.by(
        () => peer.accepted === AcceptedStatus.ACCEPTED || peer.accepted === AcceptedStatus.ACCEPTED_IN_SESSION
    );
    let isDenied = $derived.by(
        () => peer.accepted === AcceptedStatus.DENIED || peer.accepted === AcceptedStatus.DENIED_IN_SESSION
    );

    let isNew = $derived.by(() => peer.accepted === AcceptedStatus.UNKNOWN);

    function makeDecision(isAccepted: boolean, isTemporary: boolean) {
        cmdReplicator._replicatorInstance?.server?.makeDecision({
            peerId: peer.peerId,
            name: peer.name,
            decision: isAccepted,
            isTemporary: isTemporary,
        });
    }
    function revokeDecision() {
        cmdReplicator._replicatorInstance?.server?.revokeDecision({
            peerId: peer.peerId,
            name: peer.name,
        });
    }
    const cmdReplicator = getContext<() => P2PReplicator>("getReplicator")();
    const replicator = cmdReplicator._replicatorInstance!;

    const peerAttrLabels = $derived.by(() => {
        const attrs = [];
        if (peer.syncOnConnect) {
            attrs.push("✔ SYNC");
        }
        if (peer.watchOnConnect) {
            attrs.push("✔ WATCH");
        }
        if (peer.syncOnReplicationCommand) {
            attrs.push("✔ SELECT");
        }
        return attrs;
    });
    function startWatching() {
        replicator.watchPeer(peer.peerId);
    }
    function stopWatching() {
        replicator.unwatchPeer(peer.peerId);
    }

    function sync() {
        replicator.sync(peer.peerId, false);
    }

    function moreMenu(evt: MouseEvent) {
        eventHub.emitEvent(EVENT_P2P_PEER_SHOW_EXTRA_MENU, { peer, event: evt });
    }
</script>

<tr>
    <td>
        <div class="info">
            <div class="row name">
                <span class="peername">{peer.name}</span>
            </div>
            <div class="row peer-id">
                <span class="peerid">({peer.peerId})</span>
            </div>
        </div>
        <div class="status-chips">
            <div class="row">
                <span class="chip {select(acceptedStatusChip, classList)}">{acceptedStatusChip}</span>
            </div>
            {#if isAccepted}
                <div class="row">
                    {#each statusChips as chip}
                        <span class="chip {select(chip, classList)}">{chip}</span>
                    {/each}
                </div>
            {/if}
            <div class="row">
                {#each peerAttrLabels as attr}
                    <span class="chip attr">{attr}</span>
                {/each}
            </div>
        </div>
    </td>
    <td>
        <div class="buttons">
            <div class="row">
                {#if isNew}
                    {#if !isAccepted}
                        <button class="button" onclick={() => makeDecision(true, true)}>Accept in session</button>
                        <button class="button mod-cta" onclick={() => makeDecision(true, false)}>Accept</button>
                    {/if}
                    {#if !isDenied}
                        <button class="button" onclick={() => makeDecision(false, true)}>Deny in session</button>
                        <button class="button mod-warning" onclick={() => makeDecision(false, false)}>Deny</button>
                    {/if}
                {:else}
                    <button class="button mod-warning" onclick={() => revokeDecision()}>Revoke</button>
                {/if}
            </div>
        </div>
    </td>
    <td>
        {#if isAccepted}
            <div class="buttons">
                <div class="row">
                    <button class="button" onclick={sync} disabled={peer.isSending || peer.isFetching}>🔄</button>
                    <!-- <button class="button" onclick={replicateFrom} disabled={peer.isFetching}>📥</button>
                    <button class="button" onclick={replicateTo} disabled={peer.isSending}>📤</button> -->
                    {#if peer.isWatching}
                        <button class="button" onclick={stopWatching}>Stop ⚡</button>
                    {:else}
                        <button class="button" onclick={startWatching} title="live">⚡</button>
                    {/if}
                    <button class="button" onclick={moreMenu}>...</button>
                </div>
            </div>
        {/if}
    </td>
</tr>

<style>
    tr:nth-child(odd) {
        background-color: var(--background-primary-alt);
    }
    .info {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: var(--size-4-1) var(--size-4-1);
    }

    .peer-id {
        font-size: 0.8em;
    }
    .status-chips {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        /* min-width: 10em; */
    }
    .buttons {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }
    .buttons .row {
        display: flex;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        /* padding: var(--size-4-1) var(--size-4-1); */
    }
    .chip {
        display: inline-block;
        padding: 4px 8px;
        margin: 4px;
        border-radius: 4px;
        font-size: 0.75em;
        font-weight: bold;
        background-color: var(--tag-background);
        border: var(--tag-border-width) solid var(--tag-border-color);
    }
    .chip.connected {
        background-color: var(--background-modifier-success);
        color: var(--text-normal);
    }
    .chip.connected-live {
        background-color: var(--background-modifier-success);
        border-color: var(--background-modifier-success);
        color: var(--text-normal);
    }
    .chip.accepted {
        background-color: var(--background-modifier-success);
        color: var(--text-normal);
    }
    .chip.waiting {
        background-color: var(--background-secondary);
    }
    .chip.unknown {
        background-color: var(--background-primary);
        color: var(--text-warning);
    }
    .chip.denied {
        background-color: var(--background-modifier-error);
        color: var(--text-error);
    }
    .chip.attr {
        background-color: var(--background-secondary);
    }
    .button {
        margin: var(--size-4-1);
    }
    .button.affirmative {
        background-color: var(--interactive-accent);
        color: var(--text-normal);
    }
    .button.affirmative:hover {
        background-color: var(--interactive-accent-hover);
    }
    .button.negative {
        background-color: var(--background-modifier-error);
        color: var(--text-error);
    }
    .button.negative:hover {
        background-color: var(--background-modifier-error-hover);
    }
</style>
