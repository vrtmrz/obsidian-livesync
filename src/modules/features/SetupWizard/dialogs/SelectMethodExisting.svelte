<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Option from "@/lib/src/UI/components/Option.svelte";
    import Options from "@/lib/src/UI/components/Options.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import ExtraItems from "@/lib/src/UI/components/ExtraItems.svelte";
    import Check from "@/lib/src/UI/components/Check.svelte";
    const TYPE_USE_SETUP_URI = "use-setup-uri";
    const TYPE_SCAN_QR_CODE = "scan-qr-code";
    const TYPE_CONFIGURE_MANUALLY = "configure-manually";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_USE_SETUP_URI | typeof TYPE_SCAN_QR_CODE | typeof TYPE_CONFIGURE_MANUALLY | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
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
