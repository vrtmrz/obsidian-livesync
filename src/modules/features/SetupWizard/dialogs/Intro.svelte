<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Option from "@/modules/services/LiveSyncUI/components/Option.svelte";
    import Options from "@/modules/services/LiveSyncUI/components/Options.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { TYPE_NEW_USER, TYPE_EXISTING_USER, TYPE_CANCELLED, type IntroResultType } from "./setupDialogTypes";
    import { $msg as translateMessage } from "@/common/translation";

    type Props = {
        setResult: (result: IntroResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<IntroResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_NEW_USER) {
            return translateMessage("Yes, I want to set up a new synchronisation");
        } else if (userType === TYPE_EXISTING_USER) {
            return translateMessage("Yes, I want to add this device to my existing synchronisation");
        } else {
            return translateMessage("Please select an option to proceed");
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_NEW_USER || userType === TYPE_EXISTING_USER;
    });
</script>

<DialogHeader title={translateMessage("Welcome to Self-hosted LiveSync")} />
<Guidance
    >{translateMessage(
        "We will now guide you through a few questions to simplify the synchronisation setup."
    )}</Guidance
>
<InfoNote>
    {translateMessage(
        "This first setup has several short steps because it confirms encryption, the connection method, and which device provides the initial data. Once it is complete, additional devices can reuse a Setup URI."
    )}
</InfoNote>
<Instruction>
    <Question>{translateMessage("First, please select the option that best describes your current situation.")}</Question>
    <Options>
        <Option
            selectedValue={TYPE_NEW_USER}
            title={translateMessage("I am setting this up for the first time")}
            bind:value={userType}
        >
            {translateMessage(
                "(Select this if you are configuring this device as the first synchronisation device.) This option is suitable if you are new to LiveSync and want to set it up from scratch."
            )}
        </Option>
        <Option
            selectedValue={TYPE_EXISTING_USER}
            title={translateMessage("I am adding a device to an existing synchronisation setup")}
            bind:value={userType}
        >
            {translateMessage(
                "(Select this if you are already using synchronisation on another computer or smartphone.) This option is suitable if you are new to LiveSync and want to set it up from scratch."
            )}
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={translateMessage("No, please take me back")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
