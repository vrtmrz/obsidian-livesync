<script lang="ts">
    import DialogHeader from "@lib/UI/components/DialogHeader.svelte";
    import Guidance from "@lib/UI/components/Guidance.svelte";
    import Decision from "@lib/UI/components/Decision.svelte";
    import Instruction from "@lib/UI/components/Instruction.svelte";
    import UserDecisions from "@lib/UI/components/UserDecisions.svelte";
    import { TYPE_CLOSE, type ScanQRCodeResultType } from "./setupDialogTypes";
    import { $msg as msg } from "@lib/common/i18n.ts";

    type Props = {
        setResult: (_result: ScanQRCodeResultType) => void;
    };
    const { setResult }: Props = $props();
</script>

<DialogHeader title="Scan QR Code" />
<Guidance>{msg("Please follow the steps below to import settings from your existing device.")}</Guidance>
<Instruction>
    <!-- <Question>How would you like to configure the connection to your server?</Question> -->
    <ol>
        <li>{msg("On this device, please keep this Vault open.")}</li>
        <li>{msg("On the source device, open Obsidian.")}</li>
        <li>{msg("On the source device, from the command palette, run the 'Show settings as a QR code' command.")}</li>
        <li>{msg("On this device, switch to the camera app or use a QR code scanner to scan the displayed QR code.")}</li>
    </ol>
</Instruction>
<UserDecisions>
    <Decision title="Close this dialog" important={true} commit={() => setResult(TYPE_CLOSE)} />
</UserDecisions>
