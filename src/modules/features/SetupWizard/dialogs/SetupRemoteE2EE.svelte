<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import ExtraItems from "@/lib/src/UI/components/ExtraItems.svelte";
    import InputRow from "@/lib/src/UI/components/InputRow.svelte";
    import Password from "@/lib/src/UI/components/Password.svelte";
    import { $msg as msg, currentLang as lang } from "../../../../lib/src/common/i18n.ts";
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

<DialogHeader title={msg("Setup.RemoteE2EE.Title", {}, lang)} />
<Guidance>{msg("Setup.RemoteE2EE.Guidance", {}, lang)}</Guidance>
<InputRow label={msg("Setup.RemoteE2EE.LabelEncrypt", {}, lang)}>
    <input type="checkbox" bind:checked={encryptionSettings.encrypt} />
    <Password
        name="e2ee-passphrase"
        placeholder={msg("Setup.RemoteE2EE.PlaceholderPassphrase", {}, lang)}
        bind:value={encryptionSettings.passphrase}
        disabled={!encryptionSettings.encrypt}
        required={encryptionSettings.encrypt}
    />
</InputRow>
<InfoNote title={msg("Setup.RemoteE2EE.StronglyRecommendedTitle", {}, lang)}>
    {msg("Setup.RemoteE2EE.StronglyRecommendedLine1", {}, lang)}
    <br />
    {msg("Setup.RemoteE2EE.StronglyRecommendedLine2", {}, lang)}
</InfoNote>
<InfoNote warning>
    {msg("Setup.RemoteE2EE.MultiDestinationWarning", {}, lang)}
</InfoNote>
<InputRow label={msg("Setup.RemoteE2EE.LabelObfuscateProperties", {}, lang)}>
    <input
        type="checkbox"
        bind:checked={encryptionSettings.usePathObfuscation}
        disabled={!encryptionSettings.encrypt}
    />
</InputRow>

<InfoNote>
    {msg("Setup.RemoteE2EE.ObfuscatePropertiesDesc", {}, lang)}
</InfoNote>

<ExtraItems title={msg("Setup.RemoteE2EE.AdvancedTitle", {}, lang)}>
    <InputRow label={msg("Setup.RemoteE2EE.LabelEncryptionAlgorithm", {}, lang)}>
        <select bind:value={encryptionSettings.E2EEAlgorithm} disabled={!encryptionSettings.encrypt}>
            {#each Object.values(E2EEAlgorithms) as alg}
                <option value={alg}>{E2EEAlgorithmNames[alg] ?? alg}</option>
            {/each}
        </select>
    </InputRow>
    <InfoNote>
        {msg(
            "Setup.RemoteE2EE.DefaultAlgorithmDesc",
            {
                algorithm: E2EEAlgorithmNames[DEFAULT_SETTINGS.E2EEAlgorithm] ?? DEFAULT_SETTINGS.E2EEAlgorithm,
            },
            lang
        )}
    </InfoNote>
    <InfoNote warning>
        {msg("Setup.RemoteE2EE.AlgorithmWarning", {}, lang)}
    </InfoNote>
</ExtraItems>

<InfoNote warning>
    <p>
        {msg("Setup.RemoteE2EE.PassphraseValidationLine1", {}, lang)}
    </p>
    <p>
        {msg("Setup.RemoteE2EE.PassphraseValidationLine2", {}, lang)}
    </p>
</InfoNote>

<UserDecisions>
    <Decision title={msg("Setup.RemoteE2EE.ButtonProceed", {}, lang)} important disabled={!e2eeValid} commit={() => commit()} />
    <Decision title={msg("Setup.RemoteE2EE.ButtonCancel", {}, lang)} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
