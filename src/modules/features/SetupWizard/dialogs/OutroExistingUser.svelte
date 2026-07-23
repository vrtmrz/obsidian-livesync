<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { $msg as translateMessage } from "@/common/translation";

    import { TYPE_CANCELLED, TYPE_APPLY, type OutroExistingUserResultType } from "./setupDialogTypes";
    type Props = {
        setResult: (result: OutroExistingUserResultType) => void;
        getInitialData?: () => { isP2P?: boolean } | undefined;
    };
    const { setResult, getInitialData }: Props = $props();
    const isP2P = $derived(getInitialData?.()?.isP2P === true);
</script>

{#if isP2P}
    <DialogHeader title={translateMessage("Setup Complete: Preparing to Fetch from Another Device")} />
    <Guidance>
        <p>
            {translateMessage(
                "The P2P connection has been configured successfully. The initial synchronisation data must now be fetched from an online source device."
            )}
        </p>
        <p>
            <strong>PLEASE NOTE</strong>
            <br />
            {translateMessage(
                "After restarting, select an online source device for the initial Fetch. The local LiveSync database on this device will be rebuilt from that source. Unsynchronised files in this Vault may conflict with the fetched data."
            )}
        </p>
    </Guidance>
    <Instruction>
        <Question>
            {translateMessage("Restart this device, then choose the source device when P2P Rebuild opens.")}
        </Question>
    </Instruction>
    <UserDecisions>
        <Decision
            title={translateMessage("Restart and Select Source Device")}
            important={true}
            commit={() => setResult(TYPE_APPLY)}
        />
        <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
    </UserDecisions>
{:else}
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
{/if}
