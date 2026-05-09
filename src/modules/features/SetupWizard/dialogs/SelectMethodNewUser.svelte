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
    const TYPE_CONFIGURE_MANUALLY = "configure-manually";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_USE_SETUP_URI | typeof TYPE_CONFIGURE_MANUALLY | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_USE_SETUP_URI) {
            return "Ui.SetupWizard.SelectNew.ProceedSetupUri";
        } else if (userType === TYPE_CONFIGURE_MANUALLY) {
            return "Ui.SetupWizard.SelectNew.ProceedManual";
        } else {
            return "Ui.SetupWizard.Common.ProceedSelectOption";
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_USE_SETUP_URI || userType === TYPE_CONFIGURE_MANUALLY;
    });
</script>

<DialogHeader title="Ui.SetupWizard.SelectNew.Title" />
<Guidance>{msg("Ui.SetupWizard.SelectNew.Guidance")}</Guidance>
<Instruction>
    <Question>How would you like to configure the connection to your server?</Question>
    <Options>
        <Option selectedValue={TYPE_USE_SETUP_URI} title="Ui.SetupWizard.SelectNew.SetupUriOption" bind:value={userType}>
            {msg("Ui.SetupWizard.SelectNew.SetupUriOptionDesc")}
        </Option>
        <Option
            selectedValue={TYPE_CONFIGURE_MANUALLY}
            title="Ui.SetupWizard.SelectNew.ManualOption"
            bind:value={userType}
        >
            This is an advanced option for users who do not have a URI or who wish to configure detailed settings.
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="Ui.SetupWizard.Common.Cancel" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
