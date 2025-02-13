<script lang="ts">
    import { getContext } from "svelte";
    import { AcceptedStatus, ConnectionStatus, type PeerStatus } from "./P2PReplicatorPaneView";
    import { Menu, Setting } from "obsidian";
    import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, Logger } from "octagonal-wheels/common/logger";
    import type { P2PReplicator } from "../CmdP2PSync";
    import { unique } from "../../../lib/src/common/utils";
    import { REMOTE_P2P } from "src/lib/src/common/types";

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
    function replicateFrom() {
        replicator.replicateFrom(peer.peerId);
    }
    function replicateTo() {
        replicator.requestSynchroniseToPeer(peer.peerId);
    }
    function sync() {
        replicator.sync(peer.peerId, false);
    }
    function addToList(item: string, list: string) {
        return unique(
            list
                .split(",")
                .map((e) => e.trim())
                .concat(item)
                .filter((p) => p)
        ).join(",");
    }
    function removeFromList(item: string, list: string) {
        return list
            .split(",")
            .map((e) => e.trim())
            .filter((p) => p !== item)
            .filter((p) => p)
            .join(",");
    }
    function moreMenu(evt: MouseEvent) {
        const m = new Menu()
            .addItem((item) => item.setTitle("📥 Only Fetch").onClick(() => replicateFrom()))
            .addItem((item) => item.setTitle("📤 Only Send").onClick(() => replicateTo()))
            .addSeparator()
            .addItem((item) => {
                item.setTitle("🔧 Get Configuration").onClick(async () => {
                    Logger(
                        `Requesting remote config for ${peer.name}. Please input the passphrase on the remote device`,
                        LOG_LEVEL_NOTICE
                    );
                    const remoteConfig = await replicator.getRemoteConfig(peer.peerId);
                    if (remoteConfig) {
                        Logger(`Remote config for ${peer.name} is retrieved successfully`);
                        const DROP = "Yes, and drop local database";
                        const KEEP = "Yes, but keep local database";
                        const CANCEL = "No, cancel";
                        const yn = await replicator.confirm.askSelectStringDialogue(
                            `Do you really want to apply the remote config? This will overwrite your current config immediately and restart.
And you can also drop the local database to rebuild from the remote device.`,
                            [DROP, KEEP, CANCEL] as const,
                            {
                                defaultAction: CANCEL,
                                title: "Apply Remote Config ",
                            }
                        );
                        if (yn === DROP || yn === KEEP) {
                            if (yn === DROP) {
                                if (remoteConfig.remoteType !== REMOTE_P2P) {
                                    const yn2 = await replicator.confirm.askYesNoDialog(
                                        `Do you want to set the remote type to "P2P Sync" to rebuild by "P2P replication"?`,
                                        {
                                            title: "Rebuild from remote device",
                                        }
                                    );
                                    if (yn2 === "yes") {
                                        remoteConfig.remoteType = REMOTE_P2P;
                                        remoteConfig.P2P_RebuildFrom = peer.name;
                                    }
                                }
                            }
                            cmdReplicator.plugin.settings = remoteConfig;
                            await cmdReplicator.plugin.saveSettings();
                            // await cmdReplicator.setConfig("rebuildFrom", peer.name);
                            if (yn === DROP) {
                                await cmdReplicator.plugin.rebuilder.scheduleFetch();
                            } else {
                                await cmdReplicator.plugin.$$scheduleAppReload();
                            }
                        } else {
                            Logger(`Cancelled\nRemote config for ${peer.name} is not applied`, LOG_LEVEL_NOTICE);
                        }
                    } else {
                        Logger(`Cannot retrieve remote config for ${peer.peerId}`);
                    }
                });
            })
            .addSeparator()
            .addItem((item) => {
                const mark = peer.syncOnConnect ? "checkmark" : null;
                item.setTitle("Toggle Sync on connect")
                    .onClick(async () => {
                        // TODO: Fix to prevent writing to settings directly
                        if (peer.syncOnConnect) {
                            cmdReplicator.settings.P2P_AutoSyncPeers = removeFromList(
                                peer.name,
                                cmdReplicator.settings.P2P_AutoSyncPeers
                            );
                            await cmdReplicator.plugin.saveSettings();
                        } else {
                            cmdReplicator.settings.P2P_AutoSyncPeers = addToList(
                                peer.name,
                                cmdReplicator.settings.P2P_AutoSyncPeers
                            );
                            await cmdReplicator.plugin.saveSettings();
                        }
                    })
                    .setIcon(mark);
            })
            .addItem((item) => {
                const mark = peer.watchOnConnect ? "checkmark" : null;
                item.setTitle("Toggle Watch on connect")
                    .onClick(async () => {
                        // TODO: Fix to prevent writing to settings directly
                        if (peer.watchOnConnect) {
                            cmdReplicator.settings.P2P_AutoWatchPeers = removeFromList(
                                peer.name,
                                cmdReplicator.settings.P2P_AutoWatchPeers
                            );
                            await cmdReplicator.plugin.saveSettings();
                        } else {
                            cmdReplicator.settings.P2P_AutoWatchPeers = addToList(
                                peer.name,
                                cmdReplicator.settings.P2P_AutoWatchPeers
                            );
                            await cmdReplicator.plugin.saveSettings();
                        }
                    })
                    .setIcon(mark);
            })
            .addItem((item) => {
                const mark = peer.syncOnReplicationCommand ? "checkmark" : null;
                item.setTitle("Toggle Sync on `Replicate now` command")
                    .onClick(async () => {
                        // TODO: Fix to prevent writing to settings directly
                        if (peer.syncOnReplicationCommand) {
                            cmdReplicator.settings.P2P_SyncOnReplication = removeFromList(
                                peer.name,
                                cmdReplicator.settings.P2P_SyncOnReplication
                            );
                            await cmdReplicator.plugin.saveSettings();
                        } else {
                            cmdReplicator.settings.P2P_SyncOnReplication = addToList(
                                peer.name,
                                cmdReplicator.settings.P2P_SyncOnReplication
                            );
                            await cmdReplicator.plugin.saveSettings();
                        }
                    })
                    .setIcon(mark);
            });
        m.showAtPosition({ x: evt.x, y: evt.y });
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
