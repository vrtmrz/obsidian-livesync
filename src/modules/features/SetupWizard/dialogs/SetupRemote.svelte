<script lang="ts">
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
            return "Continue to CouchDB setup";
        } else if (userType === TYPE_BUCKET) {
            return "Continue to S3/MinIO/R2 setup";
        } else if (userType === TYPE_P2P) {
            return "Continue to Peer-to-Peer only setup";
        } else {
            return "Please select an option to proceed";
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_COUCHDB || userType === TYPE_BUCKET || userType === TYPE_P2P;
    });
</script>

<DialogHeader title="Enter Server Information" />
<Instruction>
    <Question>Please select the type of server to which you are connecting.</Question>
    <Options>
        <Option selectedValue={TYPE_COUCHDB} title="CouchDB" bind:value={userType}>
            This is the most suitable synchronisation method for the design. All functions are available. You must have
            set up a CouchDB instance.
        </Option>
        <Option selectedValue={TYPE_BUCKET} title="S3/MinIO/R2 Object Storage" bind:value={userType}>
            Synchronisation utilising journal files. You must have set up an S3/MinIO/R2 compatible object storage.
        </Option>
        <Option selectedValue={TYPE_P2P} title="Peer-to-Peer only" bind:value={userType}>
            This is an experimental feature enabling direct synchronisation between devices. No server is required, but
            both devices must be online at the same time for synchronisation to occur, and some features may be limited.
            Internet connection is only required to signalling (detecting peers) and not for data transfer.
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
