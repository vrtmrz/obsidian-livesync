<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Option from "@/modules/services/LiveSyncUI/components/Option.svelte";
    import Options from "@/modules/services/LiveSyncUI/components/Options.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { $msg as translateMessage } from "@/common/translation";
    import { onMount } from "svelte";
    import { type GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { TYPE_CANCELLED, type SetupRemoteInitialData, type SetupRemoteResultType } from "./setupDialogTypes";

    type Props = GuestDialogProps<SetupRemoteResultType, SetupRemoteInitialData>;
    const { setResult, getInitialData }: Props = $props();
    let choices = $state<SetupRemoteInitialData>([]);
    let userType = $state<SetupRemoteResultType>(TYPE_CANCELLED);
    onMount(() => {
        choices = getInitialData?.() ?? [];
    });
    const selectedChoice = $derived(choices.find((choice) => choice.type === userType));
    const proceedTitle = $derived(
        selectedChoice?.proceedTitle ?? translateMessage("Please select an option to proceed")
    );
    const canProceed = $derived(selectedChoice !== undefined);
</script>

<DialogHeader title={translateMessage("Ui.SetupWizard.SetupRemote.Title")} />
<Instruction>
    <Question>{translateMessage("Ui.SetupWizard.SetupRemote.Guidance")}</Question>
    <Options>
        {#each choices as choice (choice.type)}
            <Option selectedValue={choice.type} title={choice.title} bind:value={userType}>
                {choice.description}
            </Option>
        {/each}
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={translateMessage("No, please take me back")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
