<script lang="ts">
    import DialogHeader from "@lib/UI/components/DialogHeader.svelte";
    import Guidance from "@lib/UI/components/Guidance.svelte";
    import Decision from "@lib/UI/components/Decision.svelte";
    import Question from "@lib/UI/components/Question.svelte";
    import Instruction from "@lib/UI/components/Instruction.svelte";
    import UserDecisions from "@lib/UI/components/UserDecisions.svelte";

    import { TYPE_CANCELLED, TYPE_APPLY, type OutroExistingUserResultType } from "./setupDialogTypes";
    type Props = {
        setResult: (result: OutroExistingUserResultType) => void;
    };
    const { setResult }: Props = $props();
</script>

<DialogHeader title="Setup Complete: Preparing to Fetch Synchronisation Data" />
<Guidance>
    <p>
        The connection to the server has been configured successfully. As the next step, <strong
            >the latest synchronisation data will be downloaded from the server to this device.</strong
        >
    </p>
    <p>
        <strong>PLEASE NOTE</strong>
        <br />
        After restarting, the database on this device will be rebuilt using data from the server. If there are any unsynchronised
        files in this vault, conflicts may occur with the server data.
    </p>
</Guidance>
<Instruction>
    <Question>Please select the button below to restart and proceed to the data fetching confirmation.</Question>
</Instruction>
<UserDecisions>
    <Decision title="Restart and Fetch Data" important={true} commit={() => setResult(TYPE_APPLY)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
