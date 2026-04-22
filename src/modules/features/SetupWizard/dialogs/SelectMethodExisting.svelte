<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Option from "@/lib/src/UI/components/Option.svelte";
    import Options from "@/lib/src/UI/components/Options.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import { $msg as msg, currentLang as lang } from "../../../../lib/src/common/i18n.ts";

    const TYPE_USE_SETUP_URI = "use-setup-uri";
    const TYPE_SCAN_QR_CODE = "scan-qr-code";
    const TYPE_CONFIGURE_MANUALLY = "configure-manually";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_USE_SETUP_URI | typeof TYPE_SCAN_QR_CODE | typeof TYPE_CONFIGURE_MANUALLY | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_USE_SETUP_URI) {
            return msg("Proceed with Setup URI", {}, lang);
        } else if (userType === TYPE_CONFIGURE_MANUALLY) {
            return msg("I know my server details, let me enter them", {}, lang);
        } else if (userType === TYPE_SCAN_QR_CODE) {
            return msg("Scan the QR code displayed on an active device using this device's camera.", {}, lang);
        } else {
            return msg("Please select an option to proceed", {}, lang);
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_USE_SETUP_URI || userType === TYPE_CONFIGURE_MANUALLY || userType === TYPE_SCAN_QR_CODE;
    });
</script>

<DialogHeader title={msg("Device Setup Method", {}, lang)} />
<Guidance>{msg("You are adding this device to an existing synchronisation setup.", {}, lang)}</Guidance>
<Instruction>
    <Question>{msg("Please select a method to import the settings from another device.", {}, lang)}</Question>
    <Options>
        <Option selectedValue={TYPE_USE_SETUP_URI} title={msg("Use a Setup URI (Recommended)", {}, lang)} bind:value={userType}>
            {msg("Paste the Setup URI generated from one of your active devices.", {}, lang)}
        </Option>
        <Option selectedValue={TYPE_SCAN_QR_CODE} title={msg("Scan a QR Code (Recommended for mobile)", {}, lang)} bind:value={userType}>
            {msg("Scan the QR code displayed on an active device using this device's camera.", {}, lang)}
        </Option>
        <Option
            selectedValue={TYPE_CONFIGURE_MANUALLY}
            title={msg("Enter the server information manually", {}, lang)}
            bind:value={userType}
        >
            {msg(
                "Configure the same server information as your other devices again, manually, very advanced users only.",
                {},
                lang
            )}
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={msg("Cancel", {}, lang)} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
