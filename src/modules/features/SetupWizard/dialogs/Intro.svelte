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
    const TYPE_NEW_USER = "new-user";
    const TYPE_EXISTING_USER = "existing-user";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_NEW_USER | typeof TYPE_EXISTING_USER | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_NEW_USER) {
            return "Ui.SetupWizard.Intro.ProceedNew";
        } else if (userType === TYPE_EXISTING_USER) {
            return "Ui.SetupWizard.Intro.ProceedExisting";
        } else {
            return "Ui.SetupWizard.Common.ProceedSelectOption";
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_NEW_USER || userType === TYPE_EXISTING_USER;
    });
</script>

<DialogHeader title="Ui.SetupWizard.Intro.Title" />
<Guidance>{msg("Ui.SetupWizard.Intro.Guidance")}</Guidance>
<Instruction>
    <Question>First, please select the option that best describes your current situation.</Question>
    <Options>
        <Option selectedValue={TYPE_NEW_USER} title="Ui.SetupWizard.Intro.NewOption" bind:value={userType}>
            {msg("Ui.SetupWizard.Intro.NewOptionDesc")}
        </Option>
        <Option
            selectedValue={TYPE_EXISTING_USER}
            title="Ui.SetupWizard.Intro.ExistingOption"
            bind:value={userType}
        >
            (Select this if you are already using synchronisation on another computer or smartphone.) This option is
            suitable if you are new to LiveSync and want to set it up from scratch.
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="Ui.SetupWizard.Common.Back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
