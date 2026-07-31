<script lang="ts">
    import { configURIBase } from "@/common/types";
    import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import InputRow from "@/modules/services/LiveSyncUI/components/InputRow.svelte";
    import Password from "@/modules/services/LiveSyncUI/components/Password.svelte";

    import { onMount } from "svelte";
    import { decryptString } from "@vrtmrz/livesync-commonlib/compat/encryption/stringEncryption";
    import type { GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { TYPE_CANCELLED, type UseSetupURIResultType } from "./setupDialogTypes";
    import { $msg as translateMessage } from "@/common/translation";

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
            error = translateMessage("Passphrase is required.");
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
            error = translateMessage("Failed to parse Setup-URI.");
            return;
        }
    }
    async function canProceed() {
        return (await processSetupURI()) ?? false;
    }
</script>

<DialogHeader title={translateMessage("Enter Setup URI")} />
<Guidance
    >{translateMessage(
        "Please enter the Setup URI that was generated during server installation or on another device, along with the vault passphrase."
    )}<br />
    {translateMessage(
        'Note that you can generate a new Setup URI by running the "Copy settings as a new Setup URI" command in the command palette.'
    )}</Guidance
>

<InputRow label={translateMessage("Setup-URI")}>
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
<InfoNote visible={seemsValid}>{translateMessage("The Setup-URI is valid and ready to use.")}</InfoNote>
<InfoNote warning visible={!seemsValid && setupURI.trim() != ""}>
    {translateMessage("The Setup-URI does not appear to be valid. Please check that you have copied it correctly.")}
</InfoNote>
<InputRow label={translateMessage("Passphrase")}>
    <Password placeholder={translateMessage("Enter your passphrase")} bind:value={passphrase} required />
</InputRow>
<InfoNote error visible={error.trim() != ""}>
    {error}
</InfoNote>

<UserDecisions>
    <Decision
        title={translateMessage("Test Settings and Continue")}
        important={true}
        disabled={!canProceed}
        commit={() => processSetupURI()}
    />
    <Decision title={translateMessage("Cancel")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
