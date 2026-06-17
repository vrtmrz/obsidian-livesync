<script lang="ts">
    import { configURIBase } from "@/common/types";
    import type { ObsidianLiveSyncSettings } from "@lib/common/types";
    import DialogHeader from "@lib/UI/components/DialogHeader.svelte";
    import Guidance from "@lib/UI/components/Guidance.svelte";
    import Decision from "@lib/UI/components/Decision.svelte";
    import UserDecisions from "@lib/UI/components/UserDecisions.svelte";
    import InfoNote from "@lib/UI/components/InfoNote.svelte";
    import InputRow from "@lib/UI/components/InputRow.svelte";
    import Password from "@lib/UI/components/Password.svelte";

    import { onMount } from "svelte";
    import { decryptString } from "@lib/encryption/stringEncryption.ts";
    import type { GuestDialogProps } from "@lib/UI/svelteDialog.ts";
    import { TYPE_CANCELLED, type UseSetupURIResultType } from "./setupDialogTypes";

    type Props = GuestDialogProps<UseSetupURIResultType, string>;
    const { setResult, getInitialData }: Props = $props();

    let setupURI = $state("");
    let passphrase = $state("");
    let error = $state("");
    onMount(() => {
        if (getInitialData) {
            const initialURI = getInitialData();
            if (initialURI) {
                setupURI = initialURI;
            }
        }
    });

    const seemsValid = $derived.by(() => setupURI.startsWith(configURIBase));
    async function processSetupURI() {
        error = "";
        if (!seemsValid) return;
        if (!passphrase) {
            error = "Passphrase is required.";
            return;
        }
        try {
            const settingPieces = setupURI.substring(configURIBase.length);
            const encodedConfig = decodeURIComponent(settingPieces);
            const newConf = (await JSON.parse(
                await decryptString(encodedConfig, passphrase)
            )) as ObsidianLiveSyncSettings;
            setResult(newConf);
            // Logger("Settings imported successfully", LOG_LEVEL_NOTICE);
            return;
        } catch (e) {
            error = "Failed to parse Setup-URI.";
            return;
        }
    }
    async function canProceed() {
        return (await processSetupURI()) ?? false;
    }
</script>

<DialogHeader title="Enter Setup URI" />
<Guidance
    >Please enter the Setup URI that was generated during server installation or on another device, along with the vault
    passphrase.<br />
    Note that you can generate a new Setup URI by running the "Copy settings as a new Setup URI" command in the command palette.</Guidance
>

<InputRow label="Setup-URI">
    <input
        type="text"
        placeholder="obsidian://setuplivesync?settings=...."
        bind:value={setupURI}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
    />
</InputRow>
<InfoNote visible={seemsValid}>The Setup-URI is valid and ready to use.</InfoNote>
<InfoNote warning visible={!seemsValid && setupURI.trim() != ""}>
    The Setup-URI does not appear to be valid. Please check that you have copied it correctly.
</InfoNote>
<InputRow label="Passphrase">
    <Password placeholder="Enter your passphrase" bind:value={passphrase} required />
</InputRow>
<InfoNote error visible={error.trim() != ""}>
    {error}
</InfoNote>

<UserDecisions>
    <Decision
        title="Test Settings and Continue"
        important={true}
        disabled={!canProceed}
        commit={() => processSetupURI()}
    />
    <Decision title="Cancel" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
