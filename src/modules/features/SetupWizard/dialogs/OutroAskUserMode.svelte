<script lang="ts">
    import { $msg as msg } from "@/lib/src/common/i18n";
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Option from "@/lib/src/UI/components/Option.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    const TYPE_EXISTING = "existing-user";
    const TYPE_NEW = "new-user";
    const TYPE_COMPATIBLE_EXISTING = "compatible-existing-user";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_EXISTING | typeof TYPE_NEW | typeof TYPE_COMPATIBLE_EXISTING | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
    const canProceed = $derived.by(() => {
        return userType === TYPE_EXISTING || userType === TYPE_NEW || userType === TYPE_COMPATIBLE_EXISTING;
    });
    const proceedMessage = $derived.by(() => {
        if (userType === TYPE_NEW) {
            return msg("Ui.SetupWizard.OutroAskUserMode.ProceedNext");
        } else if (userType === TYPE_EXISTING) {
            return msg("Ui.SetupWizard.OutroAskUserMode.ProceedNext");
        } else if (userType === TYPE_COMPATIBLE_EXISTING) {
            return msg("Ui.SetupWizard.OutroAskUserMode.ProceedApplySettings");
        } else {
            return msg("Ui.SetupWizard.Common.ProceedSelectOption");
        }
    });
</script>

<DialogHeader title={msg("Ui.SetupWizard.OutroAskUserMode.Title")} />
<Guidance>{msg("Ui.SetupWizard.OutroAskUserMode.Guidance")}</Guidance>
<Instruction>
    <Question>{msg("Ui.SetupWizard.OutroAskUserMode.Question")}</Question>
    <Option title={msg("Ui.SetupWizard.OutroAskUserMode.NewOption")} bind:value={userType} selectedValue={TYPE_NEW}>
        <InfoNote>
            {msg("Ui.SetupWizard.OutroAskUserMode.NewOptionDesc")}
        </InfoNote>
    </Option>
    <Option
        title={msg("Ui.SetupWizard.OutroAskUserMode.ExistingOption")}
        bind:value={userType}
        selectedValue={TYPE_EXISTING}
    >
        <InfoNote>
            {msg("Ui.SetupWizard.OutroAskUserMode.ExistingOptionDesc")}
        </InfoNote>
    </Option>
    <Option
        title={msg("Ui.SetupWizard.OutroAskUserMode.CompatibleOption")}
        bind:value={userType}
        selectedValue={TYPE_COMPATIBLE_EXISTING}
    >
        <InfoNote warning>
            {msg("Ui.SetupWizard.OutroAskUserMode.CompatibleOptionDesc")}
        </InfoNote>
    </Option>
</Instruction>
<UserDecisions>
    <Decision title={proceedMessage} important={true} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={msg("Ui.SetupWizard.Common.Back")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
