<script lang="ts">
    import DialogHeader from "@lib/UI/components/DialogHeader.svelte";
    import Guidance from "@lib/UI/components/Guidance.svelte";
    import Decision from "@lib/UI/components/Decision.svelte";
    import Question from "@lib/UI/components/Question.svelte";
    import Option from "@lib/UI/components/Option.svelte";
    import Options from "@lib/UI/components/Options.svelte";
    import Instruction from "@lib/UI/components/Instruction.svelte";
    import UserDecisions from "@lib/UI/components/UserDecisions.svelte";
    import {
        TYPE_USE_SETUP_URI,
        TYPE_SCAN_QR_CODE,
        TYPE_CONFIGURE_MANUALLY,
        TYPE_CANCELLED,
        type SelectMethodExistingResultType,
    } from "./setupDialogTypes";

    type Props = {
        setResult: (result: SelectMethodExistingResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<SelectMethodExistingResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_USE_SETUP_URI) {
            return "Proceed with Setup URI";
        } else if (userType === TYPE_CONFIGURE_MANUALLY) {
            return "I know my server details, let me enter them";
        } else if (userType === TYPE_SCAN_QR_CODE) {
            return "Scan the QR code displayed on an active device using this device's camera.";
        } else {
            return "Please select an option to proceed";
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_USE_SETUP_URI || userType === TYPE_CONFIGURE_MANUALLY || userType === TYPE_SCAN_QR_CODE;
    });
</script>

<DialogHeader title="Device Setup Method" />
<Guidance>You are adding this device to an existing synchronisation setup.</Guidance>
<Instruction>
    <Question>Please select a method to import the settings from another device.</Question>
    <Options>
        <Option selectedValue={TYPE_USE_SETUP_URI} title="Use a Setup URI (Recommended)" bind:value={userType}>
            Paste the Setup URI generated from one of your active devices.
        </Option>
        <Option selectedValue={TYPE_SCAN_QR_CODE} title="Scan a QR Code (Recommended for mobile)" bind:value={userType}>
            Scan the QR code displayed on an active device using this device's camera.
        </Option>
        <Option
            selectedValue={TYPE_CONFIGURE_MANUALLY}
            title="Enter the server information manually"
            bind:value={userType}
        >
            Configure the same server information as your other devices again, manually, very advanced users only.
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="Cancel" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
