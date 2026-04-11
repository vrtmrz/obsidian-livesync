<script lang="ts">
    import { $msg as msg } from "@/lib/src/common/i18n";
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Option from "@/lib/src/UI/components/Option.svelte";
    import Options from "@/lib/src/UI/components/Options.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import ExtraItems from "@/lib/src/UI/components/ExtraItems.svelte";
    import Check from "@/lib/src/UI/components/Check.svelte";
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
            return msg("Ui.SetupWizard.SelectExisting.ProceedSetupUri");
        } else if (userType === TYPE_CONFIGURE_MANUALLY) {
            return msg("Ui.SetupWizard.SelectExisting.ProceedManual");
        } else if (userType === TYPE_SCAN_QR_CODE) {
            return msg("Ui.SetupWizard.SelectExisting.ProceedQr");
        } else {
            return msg("Ui.SetupWizard.Common.ProceedSelectOption");
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_USE_SETUP_URI || userType === TYPE_CONFIGURE_MANUALLY || userType === TYPE_SCAN_QR_CODE;
    });
</script>

<DialogHeader title={msg("Ui.SetupWizard.SelectExisting.Title")} />
<Guidance>{msg("Ui.SetupWizard.SelectExisting.Guidance")}</Guidance>
<Instruction>
    <Question>{msg("Ui.SetupWizard.SelectExisting.Question")}</Question>
    <Options>
        <Option selectedValue={TYPE_USE_SETUP_URI} title={msg("Ui.SetupWizard.SelectExisting.SetupUriOption")} bind:value={userType}>
            {msg("Ui.SetupWizard.SelectExisting.SetupUriOptionDesc")}
        </Option>
        <Option selectedValue={TYPE_SCAN_QR_CODE} title={msg("Ui.SetupWizard.SelectExisting.QrOption")} bind:value={userType}>
            {msg("Ui.SetupWizard.SelectExisting.QrOptionDesc")}
        </Option>
        <Option
            selectedValue={TYPE_CONFIGURE_MANUALLY}
            title={msg("Ui.SetupWizard.SelectExisting.ManualOption")}
            bind:value={userType}
        >
            {msg("Ui.SetupWizard.SelectExisting.ManualOptionDesc")}
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={msg("Ui.SetupWizard.Common.Cancel")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
