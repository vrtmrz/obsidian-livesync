<script lang="ts">
    // import { delay } from "octagonal-wheels/promises";
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import InputRow from "@/lib/src/UI/components/InputRow.svelte";
    import Password from "@/lib/src/UI/components/Password.svelte";
    import { PouchDB } from "../../../../lib/src/pouchdb/pouchdb-browser";
    import {
        DEFAULT_SETTINGS,
        P2P_DEFAULT_SETTINGS,
        PREFERRED_BASE,
        RemoteTypes,
        type EntryDoc,
        type ObsidianLiveSyncSettings,
        type P2PConnectionInfo,
        type P2PSyncSetting,
    } from "../../../../lib/src/common/types";

    import { TrysteroReplicator } from "../../../../lib/src/replication/trystero/TrysteroReplicator";
    import type { ReplicatorHostEnv } from "../../../../lib/src/replication/trystero/types";
    import { copyTo, pickP2PSyncSettings, type SimpleStore } from "../../../../lib/src/common/utils";
    import { getObsidianDialogContext } from "../ObsidianSvelteDialog";
    import { onMount } from "svelte";
    import type { GuestDialogProps } from "../../../../lib/src/UI/svelteDialog";
    import { SETTING_KEY_P2P_DEVICE_NAME } from "../../../../lib/src/common/types";

    const default_setting = pickP2PSyncSettings(DEFAULT_SETTINGS);
    let syncSetting = $state<P2PConnectionInfo>({ ...default_setting });

    const context = getObsidianDialogContext();
    let error = $state("");
    const TYPE_CANCELLED = "cancelled";
    type SettingInfo = P2PConnectionInfo;
    type ResultType = typeof TYPE_CANCELLED | SettingInfo;
    type Props = GuestDialogProps<ResultType, P2PSyncSetting>;

    const { setResult, getInitialData }: Props = $props();
    onMount(() => {
        if (getInitialData) {
            const initialData = getInitialData();
            if (initialData) {
                copyTo(initialData, syncSetting);
            }
            if (context.services.config.getSmallConfig(SETTING_KEY_P2P_DEVICE_NAME)) {
                syncSetting.P2P_DevicePeerName = context.services.config.getSmallConfig(
                    SETTING_KEY_P2P_DEVICE_NAME
                ) as string;
            } else {
                syncSetting.P2P_DevicePeerName = "";
            }
        }
    });
    function generateSetting() {
        const connSetting: P2PSyncSetting = {
            // remoteType: ",
            ...P2P_DEFAULT_SETTINGS,
            ...syncSetting,
            P2P_Enabled: true,
        };
        const trialSettings: P2PSyncSetting = {
            ...connSetting,
        };
        const trialRemoteSetting: ObsidianLiveSyncSettings = {
            ...DEFAULT_SETTINGS,
            ...PREFERRED_BASE,
            remoteType: RemoteTypes.REMOTE_P2P,
            ...trialSettings,
        };
        return trialRemoteSetting;
    }

    async function checkConnection() {
        try {
            processing = true;
            const trialRemoteSetting = generateSetting();
            const map = new Map<string, string>();
            const store = {
                get: (key: string) => {
                    return Promise.resolve(map.get(key) || null);
                },
                set: (key: string, value: any) => {
                    map.set(key, value);
                    return Promise.resolve();
                },
                delete: (key: string) => {
                    map.delete(key);
                    return Promise.resolve();
                },
                keys: () => {
                    return Promise.resolve(Array.from(map.keys()));
                },
            } as SimpleStore<any>;

            const dummyPouch = new PouchDB<EntryDoc>("dummy");
            const env: ReplicatorHostEnv = {
                settings: trialRemoteSetting,
                processReplicatedDocs: async (docs: any[]) => {
                    return;
                },
                confirm: context.plugin.confirm,
                db: dummyPouch,
                simpleStore: store,
                deviceName: syncSetting.P2P_DevicePeerName || "unnamed-device",
                platform: "setup-wizard",
            };
            const replicator = new TrysteroReplicator(env);
            try {
                await replicator.setOnSetup();
                await replicator.allowReconnection();
                await replicator.open();
                for (let i = 0; i < 10; i++) {
                    // await delay(1000);
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    // Logger(`Checking known advertisements... (${i})`, LOG_LEVEL_INFO);
                    if (replicator.knownAdvertisements.length > 0) {
                        break;
                    }
                }
                // context.holdingSettings = trialRemoteSetting;

                if (replicator.knownAdvertisements.length === 0) {
                    return "Your settings seem correct, but no other peers were found.";
                }
                return "";
            } catch (e) {
                return `Failed to connect to other peers: ${e}`;
            } finally {
                try {
                    replicator.close();
                    dummyPouch.destroy();
                } catch (e) {
                    console.error(e);
                }
            }
        } finally {
            processing = false;
        }
    }
    function setDefaultRelay() {
        syncSetting.P2P_relays = P2P_DEFAULT_SETTINGS.P2P_relays;
    }

    let processing = $state(false);
    function generateDefaultGroupId() {
        const randomValues = new Uint16Array(4);
        crypto.getRandomValues(randomValues);
        const MAX_UINT16 = 65536;
        const a = Math.floor((randomValues[0] / MAX_UINT16) * 1000);
        const b = Math.floor((randomValues[1] / MAX_UINT16) * 1000);
        const c = Math.floor((randomValues[2] / MAX_UINT16) * 1000);
        const d_range = 36 * 36 * 36;
        const d = Math.floor((randomValues[3] / MAX_UINT16) * d_range);
        syncSetting.P2P_roomID = `${a.toString().padStart(3, "0")}-${b
            .toString()
            .padStart(3, "0")}-${c.toString().padStart(3, "0")}-${d.toString(36).padStart(3, "0")}`;
    }

    async function checkAndCommit() {
        error = "";
        try {
            error = (await checkConnection()) || "";
            if (!error) {
                const setting = generateSetting();
                setResult(pickP2PSyncSettings(setting));
                return;
            }
        } catch (e) {
            error = `Error during connection test: ${e}`;
            return;
        }
    }
    function commit() {
        const setting = pickP2PSyncSettings(generateSetting());
        setResult(setting);
    }
    function cancel() {
        setResult(TYPE_CANCELLED);
    }
    const canProceed = $derived.by(() => {
        return (
            syncSetting.P2P_relays.trim() !== "" &&
            syncSetting.P2P_roomID.trim() !== "" &&
            syncSetting.P2P_passphrase.trim() !== "" &&
            (syncSetting.P2P_DevicePeerName ?? "").trim() !== ""
        );
    });
</script>

<DialogHeader title="P2P Configuration" />
<Guidance>Please enter the Peer-to-Peer Synchronisation information below.</Guidance>
<InputRow label="Enabled">
    <input type="checkbox" name="p2p-enabled" bind:checked={syncSetting.P2P_Enabled} />
</InputRow>
<InputRow label="Relay URL">
    <input
        type="text"
        name="p2p-relay-url"
        placeholder="Enter the Relay URL)"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.P2P_relays}
    />
    <button class="button" onclick={() => setDefaultRelay()}>Use vrtmrz's relay</button>
</InputRow>
<InputRow label="Group ID">
    <input
        type="text"
        name="p2p-room-id"
        placeholder="123-456-789-abc"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.P2P_roomID}
    />
    <button class="button" onclick={() => generateDefaultGroupId()}>Generate Random ID</button>
</InputRow>
<InputRow label="Passphrase">
    <Password name="p2p-password" placeholder="Enter your passphrase" bind:value={syncSetting.P2P_passphrase} />
</InputRow>
<InfoNote>
    The Group ID and passphrase are used to identify your group of devices. Make sure to use the same Group ID and
    passphrase on all devices you want to synchronise.<br />
    Note that the Group ID is not limited to the generated format; you can use any string as the Group ID.
</InfoNote>
<InputRow label="Device Peer ID">
    <input
        type="text"
        name="p2p-device-peer-id"
        placeholder="main-iphone16"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.P2P_DevicePeerName}
    />
</InputRow>
<InputRow label="Auto Start P2P Connection">
    <input type="checkbox" name="p2p-auto-start" bind:checked={syncSetting.P2P_AutoStart} />
</InputRow>
<InfoNote>
    If "Auto Start P2P Connection" is enabled, the P2P connection will be started automatically when the plug-in
    launches.
</InfoNote>
<InputRow label="Auto Broadcast Changes">
    <input type="checkbox" name="p2p-auto-broadcast" bind:checked={syncSetting.P2P_AutoBroadcast} />
</InputRow>
<InfoNote>
    If "Auto Broadcast Changes" is enabled, changes will be automatically broadcasted to connected peers without
    requiring manual intervention. This requests peers to fetch this device's changes.
</InfoNote>
<InfoNote error visible={error !== ""}>
    {error}
</InfoNote>
{#if processing}
    Checking connection... Please wait.
{:else}
    <UserDecisions>
        <Decision title="Test Settings and Continue" important disabled={!canProceed} commit={() => checkAndCommit()} />
        <Decision title="Continue anyway" commit={() => commit()} />
        <Decision title="Cancel" commit={() => cancel()} />
    </UserDecisions>
{/if}
