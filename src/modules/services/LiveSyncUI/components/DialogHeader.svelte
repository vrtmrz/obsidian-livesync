<script lang="ts">
    import { onMount, tick } from "svelte";
    import { translateIfAvailable as translate } from "@vrtmrz/livesync-commonlib/compat/common/i18n";
    import { getDialogContext } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { _activeDocument } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";

    type Props = {
        title: string;
        subtitle?: string;
        children?: () => unknown;
    };
    let { title = $bindable(), subtitle }: Props = $props();
    const context = getDialogContext();
    const translatedTitle = $derived.by(() => translate(title));
    const translatedSubtitle = $derived.by(() => (subtitle ? translate(subtitle) : ""));
    const modalTitle = $derived.by(() => `${translatedTitle}${translatedSubtitle ? ` - ${translatedSubtitle}` : ""}`);

    $effect(() => {
        if (translatedTitle) {
            context.setTitle(modalTitle);
        }
    });
    onMount(async () => {
        context.setTitle(modalTitle);
        await tick();
        _activeDocument.querySelector(".modal")?.scrollTo(0, 0);
    });
</script>

<div class="dialog-header">
    <h2>{translatedTitle}</h2>
    {#if translatedSubtitle}
        <h4>{translatedSubtitle}</h4>
    {/if}
</div>

<style>
    .dialog-header {
        display: none;
    }
</style>
