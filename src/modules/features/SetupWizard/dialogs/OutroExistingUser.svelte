<script lang="ts">
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
</script>

<DialogHeader title="Ui.SetupWizard.OutroExisting.Title" />
<Guidance message="Ui.SetupWizard.OutroExisting.Guidance" />
<Instruction>
    <Question>Please select the button below to restart and proceed to the data fetching confirmation.</Question>
</Instruction>
<UserDecisions>
    <Decision title="Ui.SetupWizard.OutroExisting.Proceed" important={true} commit={() => setResult(TYPE_APPLY)} />
    <Decision title="Ui.SetupWizard.Common.Back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
