<script lang="ts">
    import { $msg as msg } from "@/lib/src/common/i18n";
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
    import { onMount } from "svelte";
    import { getDialogContext, type GuestDialogProps } from "../../../../lib/src/UI/svelteDialog";
    import { SETTING_KEY_P2P_DEVICE_NAME } from "../../../../lib/src/common/types";
    import ExtraItems from "../../../../lib/src/UI/components/ExtraItems.svelte";
    import type { SetupRemoteP2PInitialData, SetupRemoteP2PResult } from "../resultTypes";

    const default_setting = pickP2PSyncSettings(DEFAULT_SETTINGS);
    let syncSetting = $state<P2PConnectionInfo>({ ...default_setting });

    const context = getDialogContext();
    let error = $state("");
    const TYPE_CANCELLED = "cancelled";
    type Props = GuestDialogProps<SetupRemoteP2PResult, SetupRemoteP2PInitialData>;

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
                get db() {
                    return Promise.resolve(this);
                },
            } as SimpleStore<any>;

            const dummyPouch = new PouchDB<EntryDoc>("dummy");
            const env: ReplicatorHostEnv = {
                settings: trialRemoteSetting,
                processReplicatedDocs: async (docs: any[]) => {
                    return;
                },
                confirm: context.services.confirm,
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
                    return msg("Ui.SetupWizard.P2P.NoPeersFound");
                }
                return "";
            } catch (e) {
                return msg("Ui.SetupWizard.P2P.ErrorConnectPeers", { error: `${e}` });
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
            error = msg("Ui.SetupWizard.Common.ErrorConnectionTest", { error: `${e}` });
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

<DialogHeader title="Ui.SetupWizard.P2P.Title" />
<Guidance message="Ui.P2P.Guidance" />
<InputRow label="Ui.SetupWizard.P2P.Enabled">
    <input type="checkbox" name="p2p-enabled" bind:checked={syncSetting.P2P_Enabled} />
</InputRow>
<InputRow label="Ui.SetupWizard.P2P.RelayUrl">
    <input
        type="text"
        name="p2p-relay-url"
        placeholder={msg("Ui.SetupWizard.P2P.PlaceholderRelayUrl")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.P2P_relays}
    />
    <button class="button" onclick={() => setDefaultRelay()}>Use vrtmrz's relay</button>
</InputRow>
<InputRow label="Ui.SetupWizard.P2P.GroupId">
    <input
        type="text"
        name="p2p-room-id"
        placeholder="123-456-789-abc"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.P2P_roomID}
    />
    <button class="button" onclick={() => generateDefaultGroupId()}>{msg("Ui.SetupWizard.P2P.GenerateRandomId")}</button>
</InputRow>
<InputRow label="Ui.UseSetupURI.LabelPassphrase">
    <Password
        name="p2p-password"
        placeholder="Ui.UseSetupURI.PlaceholderPassphrase"
        bind:value={syncSetting.P2P_passphrase}
    />
</InputRow>
<InfoNote message="Ui.SetupWizard.P2P.GroupPassphraseDesc" />
<InputRow label="Ui.SetupWizard.P2P.DevicePeerId">
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
<InputRow label="Ui.SetupWizard.P2P.AutoStart">
    <input type="checkbox" name="p2p-auto-start" bind:checked={syncSetting.P2P_AutoStart} />
</InputRow>
<InfoNote message="Ui.SetupWizard.P2P.AutoStartDesc" />
<InputRow label="Ui.SetupWizard.P2P.AutoBroadcast">
    <input type="checkbox" name="p2p-auto-broadcast" bind:checked={syncSetting.P2P_AutoBroadcast} />
</InputRow>
<InfoNote message="Ui.SetupWizard.P2P.AutoBroadcastDesc" />
<ExtraItems title="Ui.SetupWizard.Common.AdvancedSettings">
    <InfoNote message="Ui.SetupWizard.P2P.TurnServerDesc" />
    <InfoNote warning message="Ui.SetupWizard.P2P.PublicTurnWarning" />
    <InputRow label="Ui.SetupWizard.P2P.TurnServerUrls">
        <textarea
            name="p2p-turn-servers"
            placeholder="turn:turn.example.com:3478,turn:turn.example.com:443"
            autocapitalize="off"
            spellcheck="false"
            bind:value={syncSetting.P2P_turnServers}
            rows="5"
        ></textarea>
    </InputRow>
    <InputRow label="Ui.SetupWizard.P2P.TurnUsername">
        <input
            type="text"
            name="p2p-turn-username"
            placeholder={msg("Ui.SetupWizard.P2P.PlaceholderTurnUsername")}
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            bind:value={syncSetting.P2P_turnUsername}
        />
    </InputRow>
    <InputRow label="Ui.SetupWizard.P2P.TurnCredential">
        <Password
            name="p2p-turn-credential"
            placeholder="Ui.SetupWizard.P2P.PlaceholderTurnCredential"
            bind:value={syncSetting.P2P_turnCredential}
        />
    </InputRow>
</ExtraItems>
<InfoNote error visible={error !== ""}>
    {error}
</InfoNote>
{#if processing}
    {msg("Ui.SetupWizard.Common.CheckingConnection")}
{:else}
    <UserDecisions>
        <Decision title="Test Settings and Continue" important disabled={!canProceed} commit={() => checkAndCommit()} />
        <Decision title="Continue anyway" commit={() => commit()} />
        <Decision title="Cancel" commit={() => cancel()} />
    </UserDecisions>
{/if}
