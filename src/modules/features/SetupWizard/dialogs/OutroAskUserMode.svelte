<script lang="ts">
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
            return "Proceed to the next step.";
        } else if (userType === TYPE_EXISTING) {
            return "Proceed to the next step.";
        } else if (userType === TYPE_COMPATIBLE_EXISTING) {
            return "Apply the settings";
        } else {
            return "Please select an option to proceed";
        }
    });
</script>

<DialogHeader title="Mostly Complete: Decision Required" />
<Guidance>
    The connection to the server has been configured successfully. As the next step, <strong
        >the local database, that is to say the synchronisation information, must be reconstituted.</strong
    >
</Guidance>
<Instruction>
    <Question>Please select your situation.</Question>
    <Option title="I am setting up a new server for the first time / I want to reset my existing server." bind:value={userType} selectedValue={TYPE_NEW}>
        <InfoNote>
            Selecting this option will result in the current data on this device being used to initialise the server.
            Any existing data on the server will be completely overwritten.
        </InfoNote>
    </Option>
    <Option
        title="My remote server is already set up. I want to join this device."
        bind:value={userType}
        selectedValue={TYPE_EXISTING}
    >
        <InfoNote>
            Selecting this option will result in this device joining the existing server. You need to fetching the
            existing synchronisation data from the server to this device.
        </InfoNote>
    </Option>
    <Option
        title="The remote is already set up, and the configuration is compatible (or got compatible by this operation)."
        bind:value={userType}
        selectedValue={TYPE_COMPATIBLE_EXISTING}
    >
        <InfoNote warning>
            Unless you are certain, selecting this options is bit dangerous. It assumes that the server configuration is
            compatible with this device. If this is not the case, data loss may occur. Please ensure you know what you
            are doing.
        </InfoNote>
    </Option>
</Instruction>
<UserDecisions>
    <Decision title={proceedMessage} important={true} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
