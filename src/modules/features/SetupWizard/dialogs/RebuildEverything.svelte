<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Option from "@/modules/services/LiveSyncUI/components/Option.svelte";
    import Options from "@/modules/services/LiveSyncUI/components/Options.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import ExtraItems from "@/modules/services/LiveSyncUI/components/ExtraItems.svelte";
    import Check from "@/modules/services/LiveSyncUI/components/Check.svelte";
    import { $msg as msg } from "@/common/translation";
    import {
        TYPE_CANCEL,
        TYPE_BACKUP_DONE,
        TYPE_BACKUP_SKIPPED,
        TYPE_UNABLE_TO_BACKUP,
        type RebuildEverythingResult,
        type ResultTypeBackup,
    } from "./setupDialogTypes";

    type Props = {
        setResult: (result: RebuildEverythingResult) => void;
        getInitialData?: () => { isP2P?: boolean } | undefined;
    };
    const { setResult, getInitialData }: Props = $props();
    const isP2P = $derived(getInitialData?.()?.isP2P === true);

    let backupType = $state<ResultTypeBackup>(TYPE_CANCEL);
    let confirmationCheck1 = $state(false);
    let confirmationCheck2 = $state(false);
    let confirmationCheck3 = $state(false);
    const canProceed = $derived.by(() => {
        const backupConfirmed = backupType === TYPE_BACKUP_DONE || backupType === TYPE_BACKUP_SKIPPED;
        if (isP2P) return backupConfirmed && confirmationCheck1;
        return backupConfirmed && confirmationCheck1 && confirmationCheck2 && confirmationCheck3;
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

{#if isP2P}
    <DialogHeader title={msg("Ui.SetupWizard.RebuildEverythingP2P.Title")} />
    <Guidance>{msg("Ui.SetupWizard.RebuildEverythingP2P.Guidance")}</Guidance>
    <InfoNote>{msg("Ui.SetupWizard.RebuildEverythingP2P.Note")}</InfoNote>
    <Guidance important title={msg("Ui.SetupWizard.RebuildEverythingP2P.ConfirmTitle")}>
        <Check title={msg("Ui.SetupWizard.RebuildEverythingP2P.ConfirmLocalReset")} bind:value={confirmationCheck1}>
            <InfoNote>{msg("Ui.SetupWizard.RebuildEverythingP2P.ConfirmLocalResetNote")}</InfoNote>
        </Check>
    </Guidance>
{:else}
    <DialogHeader title="Final Confirmation: Overwrite Server Data with This Device's Files" />
    <Guidance
        >This procedure will first delete all existing synchronisation data from the server. Following this, the server
        data will be completely rebuilt, using the current state of your Vault on this device (including its local
        database) as <strong>the single, authoritative master copy</strong>.</Guidance
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
{/if}
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
{#if !isP2P}
    <Instruction>
        <ExtraItems title="Advanced">
            <Check title="Prevent fetching configuration from server" bind:value={preventFetchingConfig} />
        </ExtraItems>
    </Instruction>
{/if}
<UserDecisions>
    <Decision
        title={isP2P ? msg("Ui.SetupWizard.RebuildEverythingP2P.Proceed") : "I Understand, Overwrite Server"}
        important
        disabled={!canProceed}
        commit={() => commit()}
    />
    <Decision title="Cancel" commit={() => setResult(TYPE_CANCEL)} />
</UserDecisions>
