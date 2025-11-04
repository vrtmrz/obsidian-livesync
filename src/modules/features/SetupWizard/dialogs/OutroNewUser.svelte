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
    // let userType = $state<ResultType>(TYPE_CANCELLED);
</script>

<DialogHeader title="Setup Complete: Preparing to Initialise Server" />
<Guidance>
    <p>
        The connection to the server has been configured successfully. As the next step, <strong
            >the synchronisation data on the server will be built based on the current data on this device.</strong
        >
    </p>
    <p>
        <strong>IMPORTANT</strong>
        <br />
        After restarting, the data on this device will be uploaded to the server as the 'master copy'. Please be aware that
        any unintended data currently on the server will be completely overwritten.
    </p>
</Guidance>
<Instruction>
    <Question>Please select the button below to restart and proceed to the final confirmation.</Question>
</Instruction>
<UserDecisions>
    <Decision title="Restart and Initialise Server" important={true} commit={() => setResult(TYPE_APPLY)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
