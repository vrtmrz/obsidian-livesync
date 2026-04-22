<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import { $msg as msg, currentLang as lang } from "../../../../lib/src/common/i18n.ts";
    const TYPE_CLOSE = "close";
    type ResultType = typeof TYPE_CLOSE;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
</script>

<DialogHeader title={msg("Setup.ScanQRCode.Title", {}, lang)} />
<Guidance>{msg("Setup.ScanQRCode.Guidance", {}, lang)}</Guidance>
<Instruction>
    <ol>
        <li>{msg("Setup.ScanQRCode.Step1", {}, lang)}</li>
        <li>{msg("Setup.ScanQRCode.Step2", {}, lang)}</li>
        <li>{msg("Setup.ScanQRCode.Step3", {}, lang)}</li>
        <li>{msg("Setup.ScanQRCode.Step4", {}, lang)}</li>
    </ol>
</Instruction>
<UserDecisions>
    <Decision title={msg("Setup.ScanQRCode.ButtonClose", {}, lang)} important={true} commit={() => setResult(TYPE_CLOSE)} />
</UserDecisions>
