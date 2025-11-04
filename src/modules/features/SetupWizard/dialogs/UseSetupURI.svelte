<script lang="ts">
    import { configURIBase } from "../../../../common/types";
    import type { ObsidianLiveSyncSettings } from "../../../../lib/src/common/types";
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import InputRow from "@/lib/src/UI/components/InputRow.svelte";
    import Password from "@/lib/src/UI/components/Password.svelte";

    import { onMount } from "svelte";
    import { decryptString } from "../../../../lib/src/encryption/stringEncryption.ts";
    import type { GuestDialogProps } from "../../../../lib/src/UI/svelteDialog.ts";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_CANCELLED | ObsidianLiveSyncSettings;
    type Props = GuestDialogProps<ResultType, string>;
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
