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
    const TYPE_IDENTICAL = "identical";
    const TYPE_INDEPENDENT = "independent";
    const TYPE_UNBALANCED = "unbalanced";
    const TYPE_CANCEL = "cancelled";

    const TYPE_BACKUP_DONE = "backup_done";
    const TYPE_BACKUP_SKIPPED = "backup_skipped";
    const TYPE_UNABLE_TO_BACKUP = "unable_to_backup";

    type ResultTypeVault =
        | typeof TYPE_IDENTICAL
        | typeof TYPE_INDEPENDENT
        | typeof TYPE_UNBALANCED
        | typeof TYPE_CANCEL;
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
              vault: ResultTypeVault;
              backup: ResultTypeBackup;
              extra: ResultTypeExtra;
          }
        | typeof TYPE_CANCEL;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let vaultType = $state<ResultTypeVault>(TYPE_CANCEL);
    let backupType = $state<ResultTypeBackup>(TYPE_CANCEL);
    const canProceed = $derived.by(() => {
        return (
            (vaultType === TYPE_IDENTICAL || vaultType === TYPE_INDEPENDENT || vaultType === TYPE_UNBALANCED) &&
            (backupType === TYPE_BACKUP_DONE || backupType === TYPE_BACKUP_SKIPPED)
        );
    });
    let preventFetchingConfig = $state(false);

    function commit() {
        setResult({
            vault: vaultType,
            backup: backupType,
            extra: {
                preventFetchingConfig,
            },
        });
    }
</script>

<DialogHeader title="Reset Synchronisation on This Device" />
<Guidance
    >This will rebuild the local database on this device using the most recent data from the server. This action is
    designed to resolve synchronisation inconsistencies and restore correct functionality.</Guidance
>
<Guidance important title="⚠️ Important Notice">
    <strong
        >If you have unsynchronised changes in your Vault on this device, they will likely diverge from the server's
        versions after the reset. This may result in a large number of file conflicts.</strong
    ><br />
    Furthermore, if conflicts are already present in the server data, they will be synchronised to this device as they are,
    and you will need to resolve them locally.
</Guidance>
<hr />
<Instruction>
    <Question
        ><strong>To minimise the creation of new conflicts</strong>, please select the option that best describes the
        current state of your Vault. The application will then check your files in the most appropriate way based on
        your selection.</Question
    >
    <Options>
        <Option
            selectedValue={TYPE_IDENTICAL}
            title="The files in this Vault are almost identical to the server's."
            bind:value={vaultType}
        >
            (e.g., immediately after restoring on another computer, or having recovered from a backup)
        </Option>
        <Option
            selectedValue={TYPE_INDEPENDENT}
            title="This Vault is empty, or contains only new files that are not on the server."
            bind:value={vaultType}
        >
            (e.g., setting up for the first time on a new smartphone, starting from a clean slate)
        </Option>
        <Option
            selectedValue={TYPE_UNBALANCED}
            title="There may be differences between the files in this Vault and the server."
            bind:value={vaultType}
        >
            (e.g., after editing many files whilst offline)
            <InfoNote info>
                In this scenario, Self-hosted LiveSync will recreate metadata for every file and deliberately generate
                conflicts. Where the file content is identical, these conflicts will be resolved automatically.
            </InfoNote>
        </Option>
    </Options>
</Instruction>
<hr />
<Instruction>
    <Question>Have you created a backup before proceeding?</Question>
    <InfoNote>
        We recommend that you copy your Vault folder to a safe location. This will provide a safeguard in case a large
        number of conflicts arise, or if you accidentally synchronise with an incorrect destination.
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
            title="I am unable to create a backup of my Vault."
            bind:value={backupType}
        >
            <InfoNote error visible={backupType === TYPE_UNABLE_TO_BACKUP}>
                <strong
                    >It is strongly advised to create a backup before proceeding. Continuing without a backup may lead
                    to data loss.
                </strong>
                <br />
                If you understand the risks and still wish to proceed, select so.
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
    <Decision title="Reset and Resume Synchronisation" important disabled={!canProceed} commit={() => commit()} />
    <Decision title="Cancel" commit={() => setResult(TYPE_CANCEL)} />
</UserDecisions>
