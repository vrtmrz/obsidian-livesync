<script lang="ts">
    import { $msg as msg } from "@/lib/src/common/i18n";
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
        const TYPE_APPLY = "apply";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_APPLY | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    // let userType = $state<ResultType>(TYPE_CANCELLED);
</script>

<DialogHeader title={msg("Ui.SetupWizard.OutroNewUser.Title")} />
<Guidance>
    <p>
        {msg("Ui.SetupWizard.OutroNewUser.GuidancePrimary")}
    </p>
    <p>
        <strong>{msg("Ui.SetupWizard.OutroNewUser.Important")}</strong>
        <br />
        {msg("Ui.SetupWizard.OutroNewUser.GuidanceWarning")}
    </p>
</Guidance>
<Instruction>
    <Question>{msg("Ui.SetupWizard.OutroNewUser.Question")}</Question>
</Instruction>
<UserDecisions>
    <Decision title={msg("Ui.SetupWizard.OutroNewUser.Proceed")} important={true} commit={() => setResult(TYPE_APPLY)} />
    <Decision title={msg("Ui.SetupWizard.Common.Back")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
