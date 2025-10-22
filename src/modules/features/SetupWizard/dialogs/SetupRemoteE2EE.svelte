<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import ExtraItems from "@/lib/src/UI/components/ExtraItems.svelte";
    import InputRow from "@/lib/src/UI/components/InputRow.svelte";
    import Password from "@/lib/src/UI/components/Password.svelte";
    import {
        DEFAULT_SETTINGS,
        E2EEAlgorithmNames,
        E2EEAlgorithms,
        type EncryptionSettings,
    } from "../../../../lib/src/common/types";
    import { onMount } from "svelte";
    import type { GuestDialogProps } from "../../../../lib/src/UI/svelteDialog";
    import { copyTo, pickEncryptionSettings } from "../../../../lib/src/common/utils";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_CANCELLED | EncryptionSettings;
    type Props = GuestDialogProps<ResultType, EncryptionSettings>;
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
        placeholder="Enter your passphrase"
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

<InfoNote>
    Obfuscating properties (e.g., path of file, size, creation and modification dates) adds an additional layer of
    security by making it harder to identify the structure and names of your files and folders on the remote server.
    This helps protect your privacy and makes it more difficult for unauthorized users to infer information about your
    data.
</InfoNote>

<ExtraItems title="Advanced">
    <InputRow label="Encryption Algorithm">
        <select bind:value={encryptionSettings.E2EEAlgorithm} disabled={!encryptionSettings.encrypt}>
            {#each Object.values(E2EEAlgorithms) as alg}
                <option value={alg}>{E2EEAlgorithmNames[alg] ?? alg}</option>
            {/each}
        </select>
    </InputRow>
    <InfoNote>
        In most cases, you should stick with the default algorithm ({E2EEAlgorithmNames[
            DEFAULT_SETTINGS.E2EEAlgorithm
        ]}), This setting is only required if you have an existing Vault encrypted in a different format.
    </InfoNote>
    <InfoNote warning>
        Changing the encryption algorithm will prevent access to any data previously encrypted with a different
        algorithm. Ensure that all your devices are configured to use the same algorithm to maintain access to your
        data.
    </InfoNote>
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
