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
        TYPE_POSTGREST,
        TYPE_WEBDAV,
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
            return translateMessage("Ui.SetupWizard.SetupRemote.ProceedBucket");
        } else if (userType === TYPE_P2P) {
            return translateMessage("Ui.SetupWizard.SetupRemote.ProceedP2P");
        } else if (userType === TYPE_WEBDAV) {
            return translateMessage("Ui.SetupWizard.SetupRemote.ProceedWebDAV");
        } else if (userType === TYPE_POSTGREST) {
            return translateMessage("Ui.SetupWizard.SetupRemote.ProceedPostgREST");
        } else {
            return "Please select an option to proceed";
        }
    });
    const canProceed = $derived.by(() => {
        return (
            userType === TYPE_COUCHDB ||
            userType === TYPE_BUCKET ||
            userType === TYPE_P2P ||
            userType === TYPE_WEBDAV ||
            userType === TYPE_POSTGREST
        );
    });
</script>

<DialogHeader title={translateMessage("Ui.SetupWizard.SetupRemote.Title")} />
<Instruction>
    <Question>{translateMessage("Ui.SetupWizard.SetupRemote.Guidance")}</Question>
    <Options>
        <Option selectedValue={TYPE_COUCHDB} title="CouchDB" bind:value={userType}>
            {translateMessage("Ui.SetupWizard.SetupRemote.CouchDbOptionDesc")}
        </Option>
        <Option
            selectedValue={TYPE_BUCKET}
            title={translateMessage("Ui.SetupWizard.SetupRemote.BucketOption")}
            bind:value={userType}
        >
            {translateMessage("Ui.SetupWizard.SetupRemote.BucketOptionDesc")}
        </Option>
        <Option
            selectedValue={TYPE_P2P}
            title={translateMessage("Ui.SetupWizard.SetupRemote.P2POption")}
            bind:value={userType}
        >
            {translateMessage(
                "No central data-storage server is required, but a signalling relay is required for peer discovery. Both devices must be online at the same time. Vault data travels through the encrypted P2P connection, not through the signalling relay. Some features may be limited."
            )}
        </Option>
        <Option
            selectedValue={TYPE_WEBDAV}
            title={translateMessage("Ui.SetupWizard.SetupRemote.WebDAVOption")}
            bind:value={userType}
        >
            {translateMessage("Ui.SetupWizard.SetupRemote.WebDAVOptionDesc")}
        </Option>
        <Option
            selectedValue={TYPE_POSTGREST}
            title={translateMessage("Ui.SetupWizard.SetupRemote.PostgRESTOption")}
            bind:value={userType}
        >
            {translateMessage("Ui.SetupWizard.SetupRemote.PostgRESTOptionDesc")}
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title="No, please take me back" commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
