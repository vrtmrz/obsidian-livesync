<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import Question from "@/modules/services/LiveSyncUI/components/Question.svelte";
    import Option from "@/modules/services/LiveSyncUI/components/Option.svelte";
    import Instruction from "@/modules/services/LiveSyncUI/components/Instruction.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import { $msg as msg } from "@/common/translation";
    import {
        type ApplySettingsInitialisationInitialData,
        type ApplySettingsInitialisationResultType,
        TYPE_CANCELLED,
        TYPE_FETCH,
        TYPE_REBUILD,
    } from "./setupDialogTypes";

    type Props = {
        setResult: (result: ApplySettingsInitialisationResultType) => void;
        getInitialData?: () => ApplySettingsInitialisationInitialData | undefined;
    };
    const { setResult, getInitialData }: Props = $props();
    const isP2P = $derived(getInitialData?.()?.isP2P === true);
    let selectedMode = $state<ApplySettingsInitialisationResultType>(TYPE_CANCELLED);
    const canProceed = $derived(selectedMode === TYPE_FETCH || selectedMode === TYPE_REBUILD);
    const proceedMessage = $derived.by(() => {
        if (selectedMode === TYPE_FETCH) {
            return isP2P
                ? msg("Ui.SetupWizard.ApplySettingsInitialisation.ProceedFetchP2P")
                : msg("Ui.SetupWizard.ApplySettingsInitialisation.ProceedFetch");
        }
        if (selectedMode === TYPE_REBUILD) {
            return isP2P
                ? msg("Ui.SetupWizard.ApplySettingsInitialisation.ProceedRebuildP2P")
                : msg("Ui.SetupWizard.ApplySettingsInitialisation.ProceedRebuild");
        }
        return msg("Ui.SetupWizard.Common.ProceedSelectOption");
    });
</script>

<DialogHeader title={msg("Ui.SetupWizard.ApplySettingsInitialisation.Title")} />
<Guidance>
    <p>{msg("Ui.SetupWizard.ApplySettingsInitialisation.Guidance")}</p>
</Guidance>
<Instruction>
    <Question>{msg("Ui.SetupWizard.ApplySettingsInitialisation.Question")}</Question>
    <Option
        title={msg("Ui.SetupWizard.ApplySettingsInitialisation.FetchOption")}
        bind:value={selectedMode}
        selectedValue={TYPE_FETCH}
    >
        <InfoNote notice>
            {isP2P
                ? msg("Ui.SetupWizard.ApplySettingsInitialisation.FetchOptionP2PDesc")
                : msg("Ui.SetupWizard.ApplySettingsInitialisation.FetchOptionDesc")}
        </InfoNote>
    </Option>
    <Option
        title={isP2P
            ? msg("Ui.SetupWizard.ApplySettingsInitialisation.RebuildOptionP2P")
            : msg("Ui.SetupWizard.ApplySettingsInitialisation.RebuildOption")}
        bind:value={selectedMode}
        selectedValue={TYPE_REBUILD}
    >
        <InfoNote warning={!isP2P} notice={isP2P}>
            {isP2P
                ? msg("Ui.SetupWizard.ApplySettingsInitialisation.RebuildOptionP2PDesc")
                : msg("Ui.SetupWizard.ApplySettingsInitialisation.RebuildOptionDesc")}
        </InfoNote>
    </Option>
</Instruction>
<UserDecisions>
    <Decision
        title={proceedMessage}
        important={selectedMode !== TYPE_REBUILD || isP2P}
        destructive={selectedMode === TYPE_REBUILD && !isP2P}
        disabled={!canProceed}
        commit={() => setResult(selectedMode)}
    />
    <Decision
        title={msg("Ui.SetupWizard.ApplySettingsInitialisation.Back")}
        commit={() => setResult(TYPE_CANCELLED)}
    />
</UserDecisions>
