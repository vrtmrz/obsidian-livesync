<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Option from "@/modules/services/LiveSyncUI/components/Option.svelte";
    import Options from "@/modules/services/LiveSyncUI/components/Options.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import { $msg as translateMessage } from "@/common/translation";
    import {
        TYPE_COUCHDB,
        TYPE_BUCKET,
        TYPE_P2P,
        TYPE_CANCELLED,
        type SetupRemoteResultType,
    } from "./setupDialogTypes";

    type Props = {
        setResult: (result: SetupRemoteResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<SetupRemoteResultType>(TYPE_CANCELLED);
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
            {translateMessage(
                "No central data-storage server is required, but a signalling relay is required for peer discovery. Both devices must be online at the same time. Vault data travels through the encrypted P2P connection, not through the signalling relay. Some features may be limited."
            )}
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
