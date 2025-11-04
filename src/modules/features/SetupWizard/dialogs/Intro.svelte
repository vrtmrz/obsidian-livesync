<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Option from "@/lib/src/UI/components/Option.svelte";
    import Options from "@/lib/src/UI/components/Options.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    const TYPE_NEW_USER = "new-user";
    const TYPE_EXISTING_USER = "existing-user";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_NEW_USER | typeof TYPE_EXISTING_USER | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_NEW_USER) {
            return "Yes, I want to set up a new synchronisation";
        } else if (userType === TYPE_EXISTING_USER) {
            return "Yes, I want to add this device to my existing synchronisation";
        } else {
            return "Please select an option to proceed";
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_NEW_USER || userType === TYPE_EXISTING_USER;
    });
</script>

<DialogHeader title="Welcome to Self-hosted LiveSync" />
<Guidance>We will now guide you through a few questions to simplify the synchronisation setup.</Guidance>
<Instruction>
    <Question>First, please select the option that best describes your current situation.</Question>
    <Options>
        <Option selectedValue={TYPE_NEW_USER} title="I am setting this up for the first time" bind:value={userType}>
            (Select this if you are configuring this device as the first synchronisation device.) This option is
            suitable if you are new to LiveSync and want to set it up from scratch.
        </Option>
        <Option
            selectedValue={TYPE_EXISTING_USER}
            title="I am adding a device to an existing synchronisation setup"
            bind:value={userType}
        >
            (Select this if you are already using synchronisation on another computer or smartphone.) This option is
            suitable if you are new to LiveSync and want to set it up from scratch.
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
