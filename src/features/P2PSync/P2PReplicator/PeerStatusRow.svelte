<script lang="ts">
    import { AcceptedStatus, type PeerStatus } from "@vrtmrz/livesync-commonlib/compat/replication/trystero/P2PReplicatorPaneCommon";
    import type { P2PReplicatorHandle } from "./P2PReplicatorPaneHost";
    import { $msg as translateMessage } from "@/common/translation";

    interface Props {
        peerStatus: PeerStatus;
        p2p: P2PReplicatorHandle;
        showPeerMenu?: (peer: PeerStatus, event: MouseEvent) => void;
    }

    let { peerStatus, p2p, showPeerMenu }: Props = $props();
    let peer = $derived(peerStatus);
    const currentReplicator = () => p2p.replicator;

    function select<T extends PropertyKey, U, V = undefined>(
        d: T,
        cond: Partial<Record<T, U>>,
        def: V | undefined = undefined
    ): U | V | undefined {
        return d in cond ? cond[d] : def;
    }

    let statusChips = $derived.by(() =>
        [
            peer.isWatching ? ["WATCHING"] : [],
            peer.isFetching ? ["FETCHING"] : [],
            peer.isSending ? ["SENDING"] : [],
        ].flat()
    );
    const chipLabels: Record<string, string> = {
        WATCHING: translateMessage("WATCHING"),
        FETCHING: translateMessage("FETCHING"),
        SENDING: translateMessage("SENDING"),
    };
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
        ) ?? ""
    );
    const acceptedStatusLabels: Record<string, string> = {
        ACCEPTED: translateMessage("ACCEPTED"),
        "ACCEPTED (in session)": translateMessage("ACCEPTED (in session)"),
        "DENIED (in session)": translateMessage("DENIED (in session)"),
        DENIED: translateMessage("DENIED"),
        NEW: translateMessage("NEW"),
    };
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
        currentReplicator().makeDecision({
            peerId: peer.peerId,
            name: peer.name,
            decision: isAccepted,
            isTemporary: isTemporary,
        });
    }
    function revokeDecision() {
        currentReplicator().revokeDecision({
            peerId: peer.peerId,
            name: peer.name,
        });
    }
    const peerAttrLabels = $derived.by(() => {
        const attrs = [];
        if (peer.syncOnConnect) {
            attrs.push(translateMessage("✔ SYNC"));
        }
        if (peer.watchOnConnect) {
            attrs.push(translateMessage("✔ WATCH"));
        }
        if (peer.syncOnReplicationCommand) {
            attrs.push(translateMessage("✔ SELECT"));
        }
        return attrs;
    });
    function startWatching() {
        currentReplicator().watchPeer(peer.peerId);
    }
    function stopWatching() {
        currentReplicator().unwatchPeer(peer.peerId);
    }

    function sync() {
        void currentReplicator().sync(peer.peerId, false);
    }

    function moreMenu(evt: MouseEvent) {
        showPeerMenu?.(peer, evt);
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
                <span class="chip {select(acceptedStatusChip, classList)}"
                    >{acceptedStatusLabels[acceptedStatusChip] ?? acceptedStatusChip}</span
                >
            </div>
            {#if isAccepted}
                <div class="row">
                    {#each statusChips as chip}
                        <span class="chip {select(chip, classList)}">{chipLabels[chip] ?? chip}</span>
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
                        <button class="button" onclick={() => makeDecision(true, true)}
                            >{translateMessage("Accept in session")}</button
                        >
                        <button class="button mod-cta" onclick={() => makeDecision(true, false)}
                            >{translateMessage("Accept")}</button
                        >
                    {/if}
                    {#if !isDenied}
                        <button class="button" onclick={() => makeDecision(false, true)}
                            >{translateMessage("Deny in session")}</button
                        >
                        <button class="button mod-warning" onclick={() => makeDecision(false, false)}
                            >{translateMessage("Deny")}</button
                        >
                    {/if}
                {:else}
                    <button class="button mod-warning" onclick={() => revokeDecision()}
                        >{translateMessage("Revoke")}</button
                    >
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
                        <button class="button" onclick={stopWatching}>{translateMessage("Stop ⚡")}</button>
                    {:else}
                        <button class="button" onclick={startWatching} title={translateMessage("live")}>⚡</button>
                    {/if}
                    {#if showPeerMenu}
                        <button class="button" onclick={moreMenu}>...</button>
                    {/if}
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
