<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import ExtraItems from "@/modules/services/LiveSyncUI/components/ExtraItems.svelte";
    import InputRow from "@/modules/services/LiveSyncUI/components/InputRow.svelte";
    import Password from "@/modules/services/LiveSyncUI/components/Password.svelte";
    import {
        DEFAULT_SETTINGS,
        E2EEAlgorithmNames,
        E2EEAlgorithms,
        type EncryptionSettings,
    } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import { onMount } from "svelte";
    import type { GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { copyTo, pickEncryptionSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
    import { TYPE_CANCELLED, type SetupRemoteE2EEResultType } from "./setupDialogTypes";
    import { $msg as translateMessage } from "@/common/translation";

    type Props = GuestDialogProps<SetupRemoteE2EEResultType, EncryptionSettings>;
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

<DialogHeader title={translateMessage("End-to-End Encryption")} />
<Guidance>{translateMessage("Please configure your end-to-end encryption settings.")}</Guidance>
<InputRow label={translateMessage("End-to-End Encryption")}>
    <input type="checkbox" bind:checked={encryptionSettings.encrypt} />
    <Password
        name="e2ee-passphrase"
        placeholder={translateMessage("Enter your passphrase")}
        bind:value={encryptionSettings.passphrase}
        disabled={!encryptionSettings.encrypt}
        required={encryptionSettings.encrypt}
    />
</InputRow>
<InfoNote title={translateMessage("Strongly Recommended")}>
    {translateMessage(
        "Enabling end-to-end encryption ensures that your data is encrypted on your device before being sent to the remote server. This means that even if someone gains access to the server, they won't be able to read your data without the passphrase. Make sure to remember your passphrase, as it will be required to decrypt your data on other devices."
    )}
    <br />
    {translateMessage(
        "Also, please note that if you are using Peer-to-Peer synchronization, this configuration will be used when you switch to other methods and connect to a remote server in the future."
    )}
</InfoNote>
<InfoNote warning>
    {translateMessage("This setting must be the same even when connecting to multiple synchronisation destinations.")}
</InfoNote>
<InputRow label={translateMessage("Obfuscate Properties")}>
    <input
        type="checkbox"
        bind:checked={encryptionSettings.usePathObfuscation}
        disabled={!encryptionSettings.encrypt}
    />
</InputRow>

<InfoNote>
    {translateMessage(
        "Obfuscating properties (e.g., path of file, size, creation and modification dates) adds an additional layer of security by making it harder to identify the structure and names of your files and folders on the remote server. This helps protect your privacy and makes it more difficult for unauthorized users to infer information about your data."
    )}
</InfoNote>

<ExtraItems title={translateMessage("Advanced")}>
    <InputRow label={translateMessage("Encryption Algorithm")}>
        <select bind:value={encryptionSettings.E2EEAlgorithm} disabled={!encryptionSettings.encrypt}>
            {#each Object.values(E2EEAlgorithms) as alg}
                <option value={alg}>{E2EEAlgorithmNames[alg] ?? alg}</option>
            {/each}
        </select>
    </InputRow>
    <InfoNote>
        {translateMessage(
            "In most cases, you should stick with the default algorithm (${algorithm}), This setting is only required if you have an existing Vault encrypted in a different format.",
            { algorithm: E2EEAlgorithmNames[DEFAULT_SETTINGS.E2EEAlgorithm] }
        )}
    </InfoNote>
    <InfoNote warning>
        {translateMessage(
            "Changing the encryption algorithm will prevent access to any data previously encrypted with a different algorithm. Ensure that all your devices are configured to use the same algorithm to maintain access to your data."
        )}
    </InfoNote>
</ExtraItems>

<InfoNote warning>
    <p>
        {translateMessage(
            "Please be aware that the End-to-End Encryption passphrase is not validated until the synchronisation process actually commences. This is a security measure designed to protect your data."
        )}
    </p>
    <p>
        {translateMessage(
            "Therefore, we ask that you exercise extreme caution when configuring server information manually. If an incorrect passphrase is entered, the data on the server will become corrupted."
        )} <br /><br />
        {translateMessage("Please understand that this is intended behaviour.")}
    </p>
</InfoNote>

<UserDecisions>
    <Decision title={translateMessage("Proceed")} important disabled={!e2eeValid} commit={() => commit()} />
    <Decision title={translateMessage("Cancel")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
