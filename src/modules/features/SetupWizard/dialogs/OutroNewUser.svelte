<script lang="ts">
    import DialogHeader from "@lib/UI/components/DialogHeader.svelte";
    import Guidance from "@lib/UI/components/Guidance.svelte";
    import Decision from "@lib/UI/components/Decision.svelte";
    import Question from "@lib/UI/components/Question.svelte";
    import Instruction from "@lib/UI/components/Instruction.svelte";
    import UserDecisions from "@lib/UI/components/UserDecisions.svelte";
    import { TYPE_APPLY, TYPE_CANCELLED, type OutroNewUserResultType } from "./setupDialogTypes";
    import { $msg as msg } from "@lib/common/i18n.ts";

    type Props = {
        setResult: (result: OutroNewUserResultType) => void;
    };
    const { setResult }: Props = $props();
    // let userType = $state<OutroNewUserResultType>(TYPE_CANCELLED);
</script>

<DialogHeader title="Setup Complete: Preparing to Initialise Server" />
<Guidance>
    <p>
        {msg("The connection to the server has been configured successfully. As the next step,")} <strong
            >{msg("the synchronisation data on the server will be built based on the current data on this device.")}</strong
        >
    </p>
    <p>
        <strong>{msg("IMPORTANT")}</strong>
        <br />
        {msg(
            "After restarting, the data on this device will be uploaded to the server as the 'master copy'. Please be aware that any unintended data currently on the server will be completely overwritten."
        )}
    </p>
</Guidance>
<Instruction>
    <Question>{msg("Please select the button below to restart and proceed to the final confirmation.")}</Question>
</Instruction>
<UserDecisions>
    <Decision title="Restart and Initialise Server" important={true} commit={() => setResult(TYPE_APPLY)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
