<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import ExtraItems from "@/lib/src/UI/components/ExtraItems.svelte";
    import InputRow from "@/lib/src/UI/components/InputRow.svelte";
    import Password from "@/lib/src/UI/components/Password.svelte";
    import { $msg as msg } from "@/lib/src/common/i18n";
    import {
        DEFAULT_SETTINGS,
        E2EEAlgorithmNames,
        E2EEAlgorithms,
        type EncryptionSettings,
    } from "../../../../lib/src/common/types";
    import { onMount } from "svelte";
    import type { GuestDialogProps } from "../../../../lib/src/UI/svelteDialog";
    import { copyTo, pickEncryptionSettings } from "../../../../lib/src/common/utils";
    import type { SetupRemoteE2EEInitialData, SetupRemoteE2EEResult } from "../resultTypes";
    const TYPE_CANCELLED = "cancelled";
    type Props = GuestDialogProps<SetupRemoteE2EEResult, SetupRemoteE2EEInitialData>;
    const { setResult, getInitialData }: Props = $props();
    let default_encryption: EncryptionSettings = {
        encrypt: true,
        passphrase: "",
        E2EEAlgorithm: DEFAULT_SETTINGS.E2EEAlgorithm,
        usePathObfuscation: true,
    } as EncryptionSettings;

    let encryptionSettings = $state<EncryptionSettings>({ ...default_encryption });

    onMount(() => {
        if (getInitialData) {
            const initialData = getInitialData();
            if (initialData) {
                copyTo(initialData, encryptionSettings);
            }
        }
    });
    let e2eeValid = $derived.by(() => {
        if (!encryptionSettings.encrypt) return true;
        return encryptionSettings.passphrase.trim().length >= 1;
    });

    function commit() {
        setResult(pickEncryptionSettings(encryptionSettings));
    }
</script>

<DialogHeader title="End-to-End Encryption" />
<Guidance>Please configure your end-to-end encryption settings.</Guidance>
<InputRow label="End-to-End Encryption">
    <input type="checkbox" bind:checked={encryptionSettings.encrypt} />
    <Password
        name="e2ee-passphrase"
        placeholder="Ui.UseSetupURI.PlaceholderPassphrase"
        bind:value={encryptionSettings.passphrase}
        disabled={!encryptionSettings.encrypt}
        required={encryptionSettings.encrypt}
    />
</InputRow>
<InfoNote title="Strongly Recommended">
    Enabling end-to-end encryption ensures that your data is encrypted on your device before being sent to the remote
    server. This means that even if someone gains access to the server, they won't be able to read your data without the
    passphrase. Make sure to remember your passphrase, as it will be required to decrypt your data on other devices.
    <br />
    Also, please note that if you are using Peer-to-Peer synchronization, this configuration will be used when you switch
    to other methods and connect to a remote server in the future.
</InfoNote>
<InfoNote warning>
    This setting must be the same even when connecting to multiple synchronisation destinations.
</InfoNote>
<InputRow label="Obfuscate Properties">
    <input
        type="checkbox"
        bind:checked={encryptionSettings.usePathObfuscation}
        disabled={!encryptionSettings.encrypt}
    />
</InputRow>

<ExtraItems title="Ui.RemoteE2EE.AdvancedTitle">
    <InputRow label="Ui.SetupWizard.E2EE.EncryptionAlgorithm">
        <select bind:value={encryptionSettings.E2EEAlgorithm} disabled={!encryptionSettings.encrypt}>
            {#each Object.values(E2EEAlgorithms) as alg}
                <option value={alg}>{E2EEAlgorithmNames[alg] ?? alg}</option>
            {/each}
        </select>
    </InputRow>
    <InfoNote>
        {msg("Ui.SetupWizard.E2EE.AlgorithmGuidance", {
            algorithm: E2EEAlgorithmNames[DEFAULT_SETTINGS.E2EEAlgorithm],
        })}
    </InfoNote>
    <InfoNote warning message="Ui.SetupWizard.E2EE.AlgorithmWarning" />
</ExtraItems>

<InfoNote warning>
    <p>
        Please be aware that the End-to-End Encryption passphrase is not validated until the synchronisation process
        actually commences. This is a security measure designed to protect your data.
    </p>
    <p>
        Therefore, we ask that you exercise extreme caution when configuring server information manually. If an
        incorrect passphrase is entered, the data on the server will become corrupted. <br /><br />
        Please understand that this is intended behaviour.
    </p>
</InfoNote>

<UserDecisions>
    <Decision title="Proceed" important disabled={!e2eeValid} commit={() => commit()} />
    <Decision title="Cancel" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
