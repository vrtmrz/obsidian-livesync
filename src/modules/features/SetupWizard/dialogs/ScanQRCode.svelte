<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { TYPE_CLOSE, type ScanQRCodeResultType } from "./setupDialogTypes";

    type Props = {
        setResult: (_result: ScanQRCodeResultType) => void;
    };
    const { setResult }: Props = $props();
</script>

<DialogHeader title="Scan QR Code" />
<Guidance>Please follow the steps below to import settings from your existing device.</Guidance>
<Instruction>
    <!-- <Question>How would you like to configure the connection to your server?</Question> -->
    <ol>
        <li>On this device, please keep this Vault open.</li>
        <li>On the source device, open Obsidian.</li>
        <li>On the source device, from the command palette, run the 'Show settings as a QR code' command.</li>
        <li>On this device, switch to the camera app or use a QR code scanner to scan the displayed QR code.</li>
    </ol>
</Instruction>
<UserDecisions>
    <Decision title="Close this dialog" important={true} commit={() => setResult(TYPE_CLOSE)} />
</UserDecisions>
