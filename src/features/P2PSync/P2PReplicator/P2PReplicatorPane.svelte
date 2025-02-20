<script lang="ts">
    import { onMount, setContext } from "svelte";
    import { AutoAccepting, DEFAULT_SETTINGS, type P2PSyncSetting } from "../../../lib/src/common/types";
    import {
        AcceptedStatus,
        ConnectionStatus,
        type CommandShim,
        type PeerStatus,
        type PluginShim,
    } from "../../../lib/src/replication/trystero/P2PReplicatorPaneCommon";
    import PeerStatusRow from "../P2PReplicator/PeerStatusRow.svelte";
    import { EVENT_LAYOUT_READY, eventHub } from "../../../common/events";
    import {
        type PeerInfo,
        type P2PServerInfo,
        EVENT_SERVER_STATUS,
        EVENT_REQUEST_STATUS,
        EVENT_P2P_REPLICATOR_STATUS,
    } from "../../../lib/src/replication/trystero/TrysteroReplicatorP2PServer";
    import { type P2PReplicatorStatus } from "../../../lib/src/replication/trystero/TrysteroReplicator";
    import { $msg as _msg } from "../../../lib/src/common/i18n";

    interface Props {
        plugin: PluginShim;
        cmdSync: CommandShim;
    }

    let { plugin, cmdSync }: Props = $props();
    // const cmdSync = plugin.getAddOn<P2PReplicator>("P2PReplicator")!;
    setContext("getReplicator", () => cmdSync);

    const initialSettings = { ...plugin.settings };

    let settings = $state<P2PSyncSetting>(initialSettings);
    // const vaultName = plugin.$$getVaultName();
    // const dbKey = `${vaultName}-p2p-device-name`;

    const initialDeviceName = cmdSync.getConfig("p2p_device_name") ?? plugin.$$getVaultName();
    let deviceName = $state<string>(initialDeviceName);

    let eP2PEnabled = $state<boolean>(initialSettings.P2P_Enabled);
    let eRelay = $state<string>(initialSettings.P2P_relays);
    let eRoomId = $state<string>(initialSettings.P2P_roomID);
    let ePassword = $state<string>(initialSettings.P2P_passphrase);
    let eAppId = $state<string>(initialSettings.P2P_AppID);
    let eDeviceName = $state<string>(initialDeviceName);
    let eAutoAccept = $state<boolean>(initialSettings.P2P_AutoAccepting == AutoAccepting.ALL);
    let eAutoStart = $state<boolean>(initialSettings.P2P_AutoStart);
    let eAutoBroadcast = $state<boolean>(initialSettings.P2P_AutoBroadcast);

    const isP2PEnabledModified = $derived.by(() => eP2PEnabled !== settings.P2P_Enabled);
    const isRelayModified = $derived.by(() => eRelay !== settings.P2P_relays);
    const isRoomIdModified = $derived.by(() => eRoomId !== settings.P2P_roomID);
    const isPasswordModified = $derived.by(() => ePassword !== settings.P2P_passphrase);
    const isAppIdModified = $derived.by(() => eAppId !== settings.P2P_AppID);
    const isDeviceNameModified = $derived.by(() => eDeviceName !== deviceName);
    const isAutoAcceptModified = $derived.by(() => eAutoAccept !== (settings.P2P_AutoAccepting == AutoAccepting.ALL));
    const isAutoStartModified = $derived.by(() => eAutoStart !== settings.P2P_AutoStart);
    const isAutoBroadcastModified = $derived.by(() => eAutoBroadcast !== settings.P2P_AutoBroadcast);

    const isAnyModified = $derived.by(
        () =>
            isP2PEnabledModified ||
            isRelayModified ||
            isRoomIdModified ||
            isPasswordModified ||
            isAppIdModified ||
            isDeviceNameModified ||
            isAutoAcceptModified ||
            isAutoStartModified ||
            isAutoBroadcastModified
    );

    async function saveAndApply() {
        const newSettings = {
            ...plugin.settings,
            P2P_Enabled: eP2PEnabled,
            P2P_relays: eRelay,
            P2P_roomID: eRoomId,
            P2P_passphrase: ePassword,
            P2P_AppID: eAppId,
            P2P_AutoAccepting: eAutoAccept ? AutoAccepting.ALL : AutoAccepting.NONE,
            P2P_AutoStart: eAutoStart,
            P2P_AutoBroadcast: eAutoBroadcast,
        };
        plugin.settings = newSettings;
        cmdSync.setConfig("p2p_device_name", eDeviceName);
        deviceName = eDeviceName;
        await plugin.saveSettings();
    }
    async function revert() {
        eP2PEnabled = settings.P2P_Enabled;
        eRelay = settings.P2P_relays;
        eRoomId = settings.P2P_roomID;
        ePassword = settings.P2P_passphrase;
        eAppId = settings.P2P_AppID;
        eAutoAccept = settings.P2P_AutoAccepting == AutoAccepting.ALL;
        eAutoStart = settings.P2P_AutoStart;
        eAutoBroadcast = settings.P2P_AutoBroadcast;
    }

    let serverInfo = $state<P2PServerInfo | undefined>(undefined);
    let replicatorInfo = $state<P2PReplicatorStatus | undefined>(undefined);
    const applyLoadSettings = (d: P2PSyncSetting, force: boolean) => {
        const { P2P_relays, P2P_roomID, P2P_passphrase, P2P_AppID, P2P_AutoAccepting } = d;
        if (force || !isP2PEnabledModified) eP2PEnabled = d.P2P_Enabled;
        if (force || !isRelayModified) eRelay = P2P_relays;
        if (force || !isRoomIdModified) eRoomId = P2P_roomID;
        if (force || !isPasswordModified) ePassword = P2P_passphrase;
        if (force || !isAppIdModified) eAppId = P2P_AppID;
        const newAutoAccept = P2P_AutoAccepting === AutoAccepting.ALL;
        if (force || !isAutoAcceptModified) eAutoAccept = newAutoAccept;
        if (force || !isAutoStartModified) eAutoStart = d.P2P_AutoStart;
        if (force || !isAutoBroadcastModified) eAutoBroadcast = d.P2P_AutoBroadcast;

        settings = d;
    };
    onMount(() => {
        const r = eventHub.onEvent("setting-saved", async (d) => {
            applyLoadSettings(d, false);
            closeServer();
        });
        const rx = eventHub.onEvent(EVENT_LAYOUT_READY, () => {
            applyLoadSettings(plugin.settings, true);
        });
        const r2 = eventHub.onEvent(EVENT_SERVER_STATUS, (status) => {
            serverInfo = status;
            advertisements = status?.knownAdvertisements ?? [];
        });
        const r3 = eventHub.onEvent(EVENT_P2P_REPLICATOR_STATUS, (status) => {
            replicatorInfo = status;
        });
        eventHub.emitEvent(EVENT_REQUEST_STATUS);
        return () => {
            r();
            r2();
            r3();
        };
    });
    let isConnected = $derived.by(() => {
        return serverInfo?.isConnected ?? false;
    });
    let serverPeerId = $derived.by(() => {
        return serverInfo?.serverPeerId ?? "";
    });
    let advertisements = $state<PeerInfo[]>([]);

    let autoSyncPeers = $derived.by(() =>
        settings.P2P_AutoSyncPeers.split(",")
            .map((e) => e.trim())
            .filter((e) => e)
    );
    let autoWatchPeers = $derived.by(() =>
        settings.P2P_AutoWatchPeers.split(",")
            .map((e) => e.trim())
            .filter((e) => e)
    );
    let syncOnCommand = $derived.by(() =>
        settings.P2P_SyncOnReplication.split(",")
            .map((e) => e.trim())
            .filter((e) => e)
    );

    const peers = $derived.by(() =>
        advertisements.map((ad) => {
            let accepted: AcceptedStatus;
            const isTemporaryAccepted = ad.isTemporaryAccepted;
            if (isTemporaryAccepted === undefined) {
                if (ad.isAccepted === undefined) {
                    accepted = AcceptedStatus.UNKNOWN;
                } else {
                    accepted = ad.isAccepted ? AcceptedStatus.ACCEPTED : AcceptedStatus.DENIED;
                }
            } else if (isTemporaryAccepted === true) {
                accepted = AcceptedStatus.ACCEPTED_IN_SESSION;
            } else {
                accepted = AcceptedStatus.DENIED_IN_SESSION;
            }
            const isFetching = replicatorInfo?.replicatingFrom.indexOf(ad.peerId) !== -1;
            const isSending = replicatorInfo?.replicatingTo.indexOf(ad.peerId) !== -1;
            const isWatching = replicatorInfo?.watchingPeers.indexOf(ad.peerId) !== -1;
            const syncOnStart = autoSyncPeers.indexOf(ad.name) !== -1;
            const watchOnStart = autoWatchPeers.indexOf(ad.name) !== -1;
            const syncOnReplicationCommand = syncOnCommand.indexOf(ad.name) !== -1;
            const st: PeerStatus = {
                name: ad.name,
                peerId: ad.peerId,
                accepted: accepted,
                status: ad.isAccepted ? ConnectionStatus.CONNECTED : ConnectionStatus.DISCONNECTED,
                isSending: isSending,
                isFetching: isFetching,
                isWatching: isWatching,
                syncOnConnect: syncOnStart,
                watchOnConnect: watchOnStart,
                syncOnReplicationCommand: syncOnReplicationCommand,
            };
            return st;
        })
    );

    function useDefaultRelay() {
        eRelay = DEFAULT_SETTINGS.P2P_relays;
    }
    function _generateRandom() {
        return (Math.floor(Math.random() * 1000) + 1000).toString().substring(1);
    }
    function generateRandom(length: number) {
        let buf = "";
        while (buf.length < length) {
            buf += "-" + _generateRandom();
        }
        return buf.substring(1, length);
    }
    function chooseRandom() {
        eRoomId = generateRandom(12) + "-" + Math.random().toString(36).substring(2, 5);
    }

    async function openServer() {
        await cmdSync.open();
    }
    async function closeServer() {
        await cmdSync.close();
    }
    function startBroadcasting() {
        void cmdSync.enableBroadcastCastings();
    }
    function stopBroadcasting() {
        void cmdSync.disableBroadcastCastings();
    }

    const initialDialogStatusKey = `p2p-dialog-status`;
    const getDialogStatus = () => {
        try {
            const initialDialogStatus = JSON.parse(cmdSync.getConfig(initialDialogStatusKey) ?? "{}") as {
                notice?: boolean;
                setting?: boolean;
            };
            return initialDialogStatus;
        } catch (e) {
            return {};
        }
    };
    const initialDialogStatus = getDialogStatus();
    let isNoticeOpened = $state<boolean>(initialDialogStatus.notice ?? true);
    let isSettingOpened = $state<boolean>(initialDialogStatus.setting ?? true);
    $effect(() => {
        const dialogStatus = {
            notice: isNoticeOpened,
            setting: isSettingOpened,
        };
        cmdSync.setConfig(initialDialogStatusKey, JSON.stringify(dialogStatus));
    });
</script>

<article>
    <h1>Peer to Peer Replicator</h1>
    <details bind:open={isNoticeOpened}>
        <summary>{_msg("P2P.Note.Summary")}</summary>
        <p class="important">{_msg("P2P.Note.important_note")}</p>
        <p class="important-sub">
            {_msg("P2P.Note.important_note_sub")}
        </p>
        {#each _msg("P2P.Note.description").split("\n\n") as paragraph}
            <p>{paragraph}</p>
        {/each}
    </details>
    <h2>Connection Settings</h2>
    <details bind:open={isSettingOpened}>
        <summary>{eRelay}</summary>
        <table class="settings">
            <tbody>
                <tr>
                    <th> Enable P2P Replicator </th>
                    <td>
                        <label class={{ "is-dirty": isP2PEnabledModified }}>
                            <input type="checkbox" bind:checked={eP2PEnabled} />
                        </label>
                    </td>
                </tr><tr>
                    <th> Relay settings </th>
                    <td>
                        <label class={{ "is-dirty": isRelayModified }}>
                            <input
                                type="text"
                                placeholder="wss://exp-relay.vrtmrz.net, wss://xxxxx"
                                bind:value={eRelay}
                                autocomplete="off"
                            />
                            <button onclick={() => useDefaultRelay()}> Use vrtmrz's relay </button>
                        </label>
                    </td>
                </tr>
                <tr>
                    <th> Room ID </th>
                    <td>
                        <label class={{ "is-dirty": isRoomIdModified }}>
                            <input
                                type="text"
                                placeholder="anything-you-like"
                                bind:value={eRoomId}
                                autocomplete="off"
                            />
                            <button onclick={() => chooseRandom()}> Use Random Number </button>
                        </label>
                        <span>
                            <small>
                                This can isolate your connections between devices. Use the same Room ID for the same
                                devices.</small
                            >
                        </span>
                    </td>
                </tr>
                <tr>
                    <th> Password </th>
                    <td>
                        <label class={{ "is-dirty": isPasswordModified }}>
                            <input type="password" placeholder="password" bind:value={ePassword} />
                        </label>
                        <span>
                            <small> This password is used to encrypt the connection. Use something long enough. </small>
                        </span>
                    </td>
                </tr>
                <tr>
                    <th> This device name </th>
                    <td>
                        <label class={{ "is-dirty": isDeviceNameModified }}>
                            <input type="text" placeholder="iphone-16" bind:value={eDeviceName} autocomplete="off" />
                        </label>
                    </td>
                </tr>
                <tr>
                    <th> Auto Connect </th>
                    <td>
                        <label class={{ "is-dirty": isAutoStartModified }}>
                            <input type="checkbox" bind:checked={eAutoStart} />
                        </label>
                    </td>
                </tr>
                <tr>
                    <th> Start change-broadcasting on Connect </th>
                    <td>
                        <label class={{ "is-dirty": isAutoBroadcastModified }}>
                            <input type="checkbox" bind:checked={eAutoBroadcast} />
                        </label>
                    </td>
                </tr>
                <!-- <tr>
                <th> Auto Accepting </th>
                <td>
                    <label class={{ "is-dirty": isAutoAcceptModified }}>
                        <input type="checkbox" bind:checked={eAutoAccept} />
                    </label>
                </td>
            </tr> -->
            </tbody>
        </table>
        <button disabled={!isAnyModified} class="button mod-cta" onclick={saveAndApply}>Save and Apply</button>
        <button disabled={!isAnyModified} class="button" onclick={revert}>Revert changes</button>
    </details>

    <div>
        <h2>Signaling Server Connection</h2>
        <div>
            {#if !isConnected}
                <p>No Connection</p>
            {:else}
                <p>Connected to Signaling Server (as Peer ID: {serverPeerId})</p>
            {/if}
        </div>
        <div>
            {#if !isConnected}
                <button onclick={openServer}>Connect</button>
            {:else}
                <button onclick={closeServer}>Disconnect</button>
                {#if replicatorInfo?.isBroadcasting !== undefined}
                    {#if replicatorInfo?.isBroadcasting}
                        <button onclick={stopBroadcasting}>Stop Broadcasting</button>
                    {:else}
                        <button onclick={startBroadcasting}>Start Broadcasting</button>
                    {/if}
                {/if}
                <details>
                    <summary>Broadcasting?</summary>
                    <p>
                        <small>
                            If you want to use `LiveSync`, you should broadcast changes. All `watching` peers which
                            detects this will start the replication for fetching. <br />
                            However, This should not be enabled if you want to increase your secrecy more.
                        </small>
                    </p>
                </details>
            {/if}
        </div>
    </div>

    <div>
        <h2>Peers</h2>
        <table class="peers">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Action</th>
                    <th>Command</th>
                </tr>
            </thead>
            <tbody>
                {#each peers as peer}
                    <PeerStatusRow peerStatus={peer}></PeerStatusRow>
                {/each}
            </tbody>
        </table>
    </div>
</article>

<style>
    article {
        max-width: 100%;
    }
    article p {
        user-select: text;
        -webkit-user-select: text;
    }
    h2 {
        margin-top: var(--size-4-1);
        margin-bottom: var(--size-4-1);
        padding-bottom: var(--size-4-1);
        border-bottom: 1px solid var(--background-modifier-border);
    }
    label.is-dirty {
        background-color: var(--background-modifier-error);
    }
    input {
        background-color: transparent;
    }
    th {
        /* display: flex;
        justify-content: center;
        align-items: center; */
        min-height: var(--input-height);
    }
    td {
        min-height: var(--input-height);
    }
    td > label {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        min-height: var(--input-height);
    }
    td > label > * {
        margin: auto var(--size-4-1);
    }
    table.peers {
        width: 100%;
    }
    .important {
        color: var(--text-error);
        font-size: 1.2em;
        font-weight: bold;
    }
    .important-sub {
        color: var(--text-warning);
    }
    .settings label {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        flex-wrap: wrap;
    }
</style>
