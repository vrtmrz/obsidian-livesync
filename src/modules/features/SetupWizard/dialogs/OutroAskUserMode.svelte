<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Option from "@/modules/services/LiveSyncUI/components/Option.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import {
        type OutroAskUserModeResultType,
        TYPE_CANCELLED,
        TYPE_EXISTING,
        TYPE_NEW,
        TYPE_COMPATIBLE_EXISTING,
    } from "./setupDialogTypes";
    import { $msg as translateMessage } from "@/common/translation";

    type Props = {
        setResult: (result: OutroAskUserModeResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<OutroAskUserModeResultType>(TYPE_CANCELLED);
    const canProceed = $derived.by(() => {
        return userType === TYPE_EXISTING || userType === TYPE_NEW || userType === TYPE_COMPATIBLE_EXISTING;
    });
    const proceedMessage = $derived.by(() => {
        if (userType === TYPE_NEW) {
            return translateMessage("Proceed to the next step.");
        } else if (userType === TYPE_EXISTING) {
            return translateMessage("Proceed to the next step.");
        } else if (userType === TYPE_COMPATIBLE_EXISTING) {
            return translateMessage("Apply the settings");
        } else {
            return translateMessage("Please select an option to proceed");
        }
    });
</script>

<DialogHeader title={translateMessage("Mostly Complete: Decision Required")} />
<Guidance>
    {translateMessage("The connection to the server has been configured successfully. As the next step,")} <strong
        >{translateMessage(
            "the local database, that is to say the synchronisation information, must be reconstituted."
        )}</strong
    >
</Guidance>
<Instruction>
    <Question>{translateMessage("Please select your situation.")}</Question>
    <Option
        title={translateMessage(
            "I am setting up a new server for the first time / I want to reset my existing server."
        )}
        bind:value={userType}
        selectedValue={TYPE_NEW}
    >
        <InfoNote>
            {translateMessage(
                "Selecting this option will result in the current data on this device being used to initialise the server. Any existing data on the server will be completely overwritten."
            )}
        </InfoNote>
    </Option>
    <Option
        title={translateMessage("My remote server is already set up. I want to join this device.")}
        bind:value={userType}
        selectedValue={TYPE_EXISTING}
    >
        <InfoNote>
            {translateMessage(
                "Selecting this option will result in this device joining the existing server. You need to fetching the existing synchronisation data from the server to this device."
            )}
        </InfoNote>
    </Option>
    <Option
        title={translateMessage(
            "The remote is already set up, and the configuration is compatible (or got compatible by this operation)."
        )}
        bind:value={userType}
        selectedValue={TYPE_COMPATIBLE_EXISTING}
    >
        <InfoNote warning>
            {translateMessage(
                "Unless you are certain, selecting this options is bit dangerous. It assumes that the server configuration is compatible with this device. If this is not the case, data loss may occur. Please ensure you know what you are doing."
            )}
        </InfoNote>
    </Option>
</Instruction>
<UserDecisions>
    <Decision title={proceedMessage} important={true} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={translateMessage("No, please take me back")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
