<script lang="ts">
    import { $msg as msg } from "@/lib/src/common/i18n";
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Option from "@/lib/src/UI/components/Option.svelte";
    import Options from "@/lib/src/UI/components/Options.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    const TYPE_COUCHDB = "couchdb";
    const TYPE_BUCKET = "bucket";
    const TYPE_P2P = "p2p";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_COUCHDB | typeof TYPE_BUCKET | typeof TYPE_P2P | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_COUCHDB) {
            return msg("Ui.SetupWizard.SetupRemote.ProceedCouchDb");
        } else if (userType === TYPE_BUCKET) {
            return msg("Ui.SetupWizard.SetupRemote.ProceedBucket");
        } else if (userType === TYPE_P2P) {
            return msg("Ui.SetupWizard.SetupRemote.ProceedP2P");
        } else {
            return msg("Ui.SetupWizard.Common.ProceedSelectOption");
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_COUCHDB || userType === TYPE_BUCKET || userType === TYPE_P2P;
    });
</script>

<DialogHeader title={msg("Ui.SetupWizard.SetupRemote.Title")} />
<Instruction>
    <Question>{msg("Ui.SetupWizard.SetupRemote.Guidance")}</Question>
    <Options>
        <Option selectedValue={TYPE_COUCHDB} title="CouchDB" bind:value={userType}>
            {msg("Ui.SetupWizard.SetupRemote.CouchDbOptionDesc")}
        </Option>
        <Option selectedValue={TYPE_BUCKET} title={msg("Ui.SetupWizard.SetupRemote.BucketOption")} bind:value={userType}>
            {msg("Ui.SetupWizard.SetupRemote.BucketOptionDesc")}
        </Option>
        <Option selectedValue={TYPE_P2P} title={msg("Ui.SetupWizard.SetupRemote.P2POption")} bind:value={userType}>
            {msg("Ui.SetupWizard.SetupRemote.P2POptionDesc")}
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={msg("Ui.SetupWizard.Common.Back")} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
