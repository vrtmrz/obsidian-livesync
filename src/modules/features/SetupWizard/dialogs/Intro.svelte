<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import Question from "@/lib/src/UI/components/Question.svelte";
    import Option from "@/lib/src/UI/components/Option.svelte";
    import Options from "@/lib/src/UI/components/Options.svelte";
    import Instruction from "@/lib/src/UI/components/Instruction.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import { $msg as msg, currentLang as lang } from "../../../../lib/src/common/i18n.ts";

    const TYPE_NEW_USER = "new-user";
    const TYPE_EXISTING_USER = "existing-user";
    const TYPE_CANCELLED = "cancelled";
    type ResultType = typeof TYPE_NEW_USER | typeof TYPE_EXISTING_USER | typeof TYPE_CANCELLED;
    type Props = {
        setResult: (result: ResultType) => void;
    };
    const { setResult }: Props = $props();
    let userType = $state<ResultType>(TYPE_CANCELLED);
    let proceedTitle = $derived.by(() => {
        if (userType === TYPE_NEW_USER) {
            return msg("Yes, I want to set up a new synchronisation", {}, lang);
        } else if (userType === TYPE_EXISTING_USER) {
            return msg("Yes, I want to add this device to my existing synchronisation", {}, lang);
        } else {
            return msg("Please select an option to proceed", {}, lang);
        }
    });
    const canProceed = $derived.by(() => {
        return userType === TYPE_NEW_USER || userType === TYPE_EXISTING_USER;
    });
</script>

<DialogHeader title={msg("Welcome to Self-hosted LiveSync", {}, lang)} />
<Guidance>{msg("We will now guide you through a few questions to simplify the synchronisation setup.", {}, lang)}</Guidance>
<Instruction>
    <Question>{msg("First, please select the option that best describes your current situation.", {}, lang)}</Question>
    <Options>
        <Option selectedValue={TYPE_NEW_USER} title={msg("I am setting this up for the first time", {}, lang)} bind:value={userType}>
            {msg(
                "(Select this if you are configuring this device as the first synchronisation device.) This option is suitable if you are new to LiveSync and want to set it up from scratch.",
                {},
                lang
            )}
        </Option>
        <Option
            selectedValue={TYPE_EXISTING_USER}
            title={msg("I am adding a device to an existing synchronisation setup", {}, lang)}
            bind:value={userType}
        >
            {msg(
                "(Select this if you are already using synchronisation on another computer or smartphone.) This option is suitable if you are new to LiveSync and want to set it up from scratch.",
                {},
                lang
            )}
        </Option>
    </Options>
</Instruction>
<UserDecisions>
    <Decision title={proceedTitle} important={canProceed} disabled={!canProceed} commit={() => setResult(userType)} />
    <Decision title={msg("No, please take me back", {}, lang)} commit={() => setResult(TYPE_CANCELLED)} />
</UserDecisions>
