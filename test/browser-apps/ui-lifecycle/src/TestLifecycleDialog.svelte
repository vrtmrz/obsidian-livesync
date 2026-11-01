<script lang="ts">
    import { getDialogContext, type GuestDialogProps } from "@vrtmrz/livesync-commonlib/compat/services/implements/base/SvelteDialog";

    const { setResult, getInitialData }: GuestDialogProps<string, string> = $props();
    const dialog = getDialogContext<string, string>();
    dialog.setTitle("Lifecycle dialogue");

    function submitResult() {
        setResult(`result:${getInitialData?.() ?? "none"}`);
    }
</script>

<section data-testid="lifecycle-dialog">
    <button data-testid="submit-dialog" onclick={submitResult}>Submit result</button>
    <button data-testid="close-dialog" onclick={() => dialog.closeDialog()}>Close without result</button>
</section>
