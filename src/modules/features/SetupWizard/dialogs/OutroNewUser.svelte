<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { $msg as msg } from "@/common/translation";
    import { TYPE_APPLY, TYPE_CANCELLED, type OutroNewUserResultType } from "./setupDialogTypes";

    type Props = {
        setResult: (result: OutroNewUserResultType) => void;
        getInitialData?: () => { isP2P?: boolean } | undefined;
    };
    const { setResult, getInitialData }: Props = $props();
    const isP2P = $derived(getInitialData?.()?.isP2P === true);
    // let userType = $state<OutroNewUserResultType>(TYPE_CANCELLED);
</script>

{#if isP2P}
    <DialogHeader title={msg("Ui.SetupWizard.OutroNewP2PUser.Title")} />
    <Guidance>
        <p>{msg("Ui.SetupWizard.OutroNewP2PUser.GuidancePrimary")}</p>
        <p>
            <strong>{msg("Ui.SetupWizard.OutroNewP2PUser.Important")}</strong>
            <br />
            {msg("Ui.SetupWizard.OutroNewP2PUser.GuidanceNotice")}
        </p>
    </Guidance>
    <Instruction>
        <Question>{msg("Ui.SetupWizard.OutroNewP2PUser.Question")}</Question>
    </Instruction>
    <UserDecisions>
        <Decision
            title={msg("Ui.SetupWizard.OutroNewP2PUser.Proceed")}
            important={true}
            commit={() => setResult(TYPE_APPLY)}
        />
        <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
    </UserDecisions>
{:else}
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
            After restarting, the data on this device will be uploaded to the server as the 'master copy'. Please be aware
            that any unintended data currently on the server will be completely overwritten.
        </p>
    </Guidance>
    <Instruction>
        <Question>Please select the button below to restart and proceed to the final confirmation.</Question>
    </Instruction>
    <UserDecisions>
        <Decision title="Restart and Initialise Server" important={true} commit={() => setResult(TYPE_APPLY)} />
        <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
    </UserDecisions>
{/if}
