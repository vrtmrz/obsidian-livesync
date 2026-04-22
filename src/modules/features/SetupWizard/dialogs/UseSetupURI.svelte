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
    import { $msg as msg, currentLang as lang } from "../../../../lib/src/common/i18n.ts";

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
            error = msg("Setup.UseSetupURI.ErrorPassphraseRequired", {}, lang);
            return;
        }
        try {
            const settingPieces = setupURI.substring(configURIBase.length);
            const encodedConfig = decodeURIComponent(settingPieces);
            const newConf = (await JSON.parse(
                await decryptString(encodedConfig, passphrase)
            )) as ObsidianLiveSyncSettings;
            setResult(newConf);
            return;
        } catch (e) {
            error = msg("Setup.UseSetupURI.ErrorFailedToParse", {}, lang);
            return;
        }
    }
    async function canProceed() {
        return (await processSetupURI()) ?? false;
    }
</script>

<DialogHeader title={msg("Setup.UseSetupURI.Title", {}, lang)} />
<Guidance
    >{msg("Setup.UseSetupURI.GuidanceLine1", {}, lang)}<br />
    {msg("Setup.UseSetupURI.GuidanceLine2", {}, lang)}</Guidance
>

<InputRow label={msg("Setup.UseSetupURI.LabelSetupURI", {}, lang)}>
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
<InfoNote visible={seemsValid}>{msg("Setup.UseSetupURI.ValidInfo", {}, lang)}</InfoNote>
<InfoNote warning visible={!seemsValid && setupURI.trim() != ""}>
    {msg("Setup.UseSetupURI.InvalidInfo", {}, lang)}
</InfoNote>
<InputRow label={msg("Setup.UseSetupURI.LabelPassphrase", {}, lang)}>
    <Password placeholder={msg("Setup.UseSetupURI.PlaceholderPassphrase", {}, lang)} bind:value={passphrase} required />
</InputRow>
<InfoNote error visible={error.trim() != ""}>
    {error}
</InfoNote>

<UserDecisions>
    <Decision
        title={msg("Setup.UseSetupURI.ButtonProceed", {}, lang)}
        important={true}
        disabled={!canProceed}
        commit={() => processSetupURI()}
    />
    <Decision title={msg("Setup.UseSetupURI.ButtonCancel", {}, lang)} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
