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
    const TYPE_CANCEL = "cancelled";

    const TYPE_BACKUP_DONE = "backup_done";
    const TYPE_BACKUP_SKIPPED = "backup_skipped";
    const TYPE_UNABLE_TO_BACKUP = "unable_to_backup";

    type ResultTypeBackup =
        | typeof TYPE_BACKUP_DONE
        | typeof TYPE_BACKUP_SKIPPED
        | typeof TYPE_UNABLE_TO_BACKUP
        | typeof TYPE_CANCEL;

    type ResultTypeExtra = {
        preventFetchingConfig: boolean;
    };
    type ResultType =
        | {
              backup: ResultTypeBackup;
              extra: ResultTypeExtra;
          }
        | typeof TYPE_CANCEL;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();

    let backupType = $state<ResultTypeBackup>(TYPE_CANCEL);
    let confirmationCheck1 = $state(false);
    let confirmationCheck2 = $state(false);
    let confirmationCheck3 = $state(false);
    const canProceed = $derived.by(() => {
        return (
            (backupType === TYPE_BACKUP_DONE || backupType === TYPE_BACKUP_SKIPPED) &&
            confirmationCheck1 &&
            confirmationCheck2 &&
            confirmationCheck3
        );
    });
    let preventFetchingConfig = $state(false);

    function commit() {
        setResult({
            backup: backupType,
            extra: {
                preventFetchingConfig,
            },
        });
    }
</script>

<DialogHeader title="Final Confirmation: Overwrite Server Data with This Device's Files" />
<Guidance
    >This procedure will first delete all existing synchronisation data from the server. Following this, the server data
    will be completely rebuilt, using the current state of your Vault on this device (including its local database) as
    <strong>the single, authoritative master copy</strong>.</Guidance
>
<InfoNote>
    You should perform this operation only in exceptional circumstances, such as when the server data is completely
    corrupted, when changes on all other devices are no longer needed, or when the database size has become unusually
    large in comparison to the Vault size.
</InfoNote>
<Guidance important title="⚠️ Please Confirm the Following">
    <Check
        title="I understand that all changes made on other smartphones or computers possibly could be lost."
        bind:value={confirmationCheck1}
    >
        <InfoNote>There is a way to resolve this on other devices.</InfoNote>
        <InfoNote>Of course, we can back up the data before proceeding.</InfoNote>
    </Check>
    <Check
        title="I understand that other devices will no longer be able to synchronise, and will need to be reset the synchronisation information."
        bind:value={confirmationCheck2}
    >
        <InfoNote>by resetting the remote, you will be informed on other devices.</InfoNote>
    </Check>
    <Check title="I understand that this action is irreversible once performed." bind:value={confirmationCheck3} />
</Guidance>
<hr />
<Instruction>
    <Question>Have you created a backup before proceeding?</Question>
    <InfoNote warning>
        This is an extremely powerful operation. We strongly recommend that you copy your Vault folder to a safe
        location.
    </InfoNote>
    <Options>
        <Option selectedValue={TYPE_BACKUP_DONE} title="I have created a backup of my Vault." bind:value={backupType} />
        <Option
            selectedValue={TYPE_BACKUP_SKIPPED}
            title="I understand the risks and will proceed without a backup."
            bind:value={backupType}
        />
        <Option
            selectedValue={TYPE_UNABLE_TO_BACKUP}
            title="I am unable to create a backup of my Vaults."
            bind:value={backupType}
        >
            <InfoNote error visible={backupType === TYPE_UNABLE_TO_BACKUP}>
                <strong
                    >You should create a new synchronisation destination and rebuild your data there. <br /> After that,
                    synchronise to a brand new vault on each other device with the new remote one by one.</strong
                >
            </InfoNote>
        </Option>
    </Options>
</Instruction>
<Instruction>
    <ExtraItems title="Advanced">
        <Check title="Prevent fetching configuration from server" bind:value={preventFetchingConfig} />
    </ExtraItems>
</Instruction>
<UserDecisions>
    <Decision title="I Understand, Overwrite Server" important disabled={!canProceed} commit={() => commit()} />
    <Decision title="Cancel" commit={() => setResult(TYPE_CANCEL)} />
</UserDecisions>
