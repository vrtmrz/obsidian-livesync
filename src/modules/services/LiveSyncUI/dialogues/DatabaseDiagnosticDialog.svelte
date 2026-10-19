<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import { $msg as translate } from "@/common/translation";
    import type { DatabaseDiagnosticDialogOptions } from "@/serviceFeatures/databaseDiagnosticDialogTypes";
    import type { DatabaseDiagnosticOutput } from "@/serviceFeatures/databaseDiagnostics";
    import type { DiagnosticNameMode } from "@vrtmrz/livesync-commonlib/diagnostics";

    const { setResult, getInitialData }: GuestDialogProps<"close", DatabaseDiagnosticDialogOptions> = $props();
    let options = $state<DatabaseDiagnosticDialogOptions>();
    let phase = $state<"choice" | "running" | "result" | "failed">("choice");
    let nameMode = $state<DiagnosticNameMode>("pseudonym");
    let processed = $state(0);
    let cancelling = $state(false);
    let output = $state<DatabaseDiagnosticOutput>();
    let selectedFormat = $state("");
    let actionStatus = $state("");
    let disposed = false;
    const selected = $derived(output?.artifacts.find((artifact) => artifact.format === selectedFormat));
    const title = $derived(
        options?.kind === "integrity" ? translate("Inspect database integrity") : translate("Analyse database usage")
    );
    const statusText = $derived(
        output
            ? {
                  complete: translate("Inspection completed. Review the findings and coverage before sharing."),
                  partial: translate("Inspection partially completed. Some information could not be checked; review the reported reasons."),
                  failed: translate("Inspection failed. The report records the available evidence and reasons."),
                  cancelled: translate("Inspection cancelled. The report contains only the evidence collected so far."),
              }[output.status]
            : ""
    );
    onMount(() => {
        options = getInitialData?.();
    });
    onDestroy(() => {
        disposed = true;
        options?.cancel();
    });

    async function begin() {
        if (!options || phase !== "choice") return;
        phase = "running";
        try {
            const result = await options.run(nameMode, (count) => {
                if (!disposed) processed = count;
            });
            if (disposed) return;
            output = result;
            selectedFormat = result.artifacts[0].format;
            phase = "result";
        } catch {
            if (!disposed) phase = "failed";
        }
    }

    async function copyReport(event: MouseEvent) {
        if (!selected) return;
        const owner = (event.currentTarget as HTMLElement).ownerDocument.defaultView;
        try {
            await owner?.navigator.clipboard.writeText(selected.content);
            actionStatus = translate("Report copied.");
        } catch {
            actionStatus = translate("Copy failed. Select the report text and copy it manually.");
        }
    }

    function saveReport(event: MouseEvent) {
        if (!selected) return;
        const document = (event.currentTarget as HTMLElement).ownerDocument;
        const url = URL.createObjectURL(new Blob([selected.content], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = selected.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        actionStatus = translate("Download requested. You can also copy the report if downloads are unavailable on this device.");
    }
</script>

<DialogHeader {title} />
<div class="database-diagnostic" data-diagnostic-phase={phase}>
    {#if phase === "choice"}
        <p>{translate("Choose how names appear in this run. Pseudonyms replace paths and identifiers consistently. Original names include private filenames. File contents and credentials are omitted in either mode.")}</p>
        <p>
            {options?.kind === "usage"
                ? translate("Read available local revisions and report their Chunk references. Settings are left unchanged.")
                : translate("Read normal-file Metadata, current conflicts, and content for suspect groups from this device and CouchDB. Other remote types and older revision history are outside this inspection. Results do not authorise deletion.")}
        </p>
        <fieldset class="diagnostic-options">
            <legend>{translate("Names in this report")}</legend>
            <div class="diagnostic-option-list">
                <label>
                    <input type="radio" name="database-diagnostic-name-mode" value="pseudonym" bind:group={nameMode} />
                    <span>{translate("Pseudonyms (recommended)")}</span>
                </label>
                <label>
                    <input type="radio" name="database-diagnostic-name-mode" value="original" bind:group={nameMode} />
                    <span>{translate("Original names")}</span>
                </label>
            </div>
        </fieldset>
        <div class="diagnostic-controls">
            <button onclick={() => setResult("close")}>{translate("Cancel")}</button>
            <button class="mod-cta" disabled={!options} onclick={() => void begin()}>{translate("Begin inspection")}</button>
        </div>
    {:else if phase === "running"}
        <p role="status">
            {cancelling ? translate("Cancelling inspection…") : `${translate("Items inspected")}: ${processed}`}
        </p>
        <button disabled={cancelling} onclick={() => { cancelling = true; options?.cancel(); }}>
            {translate("Cancel inspection")}
        </button>
    {:else if phase === "result" && output}
        <p role="status">{statusText}</p>
        <p>
            {output.nameMode === "pseudonym"
                ? translate("This report uses temporary pseudonyms. Counts and relationships remain visible.")
                : translate("This report contains original paths and identifiers. Review them before sharing.")}
        </p>
        {#if options?.kind === "usage" && output.status !== "complete"}
            <p>{translate("Partial Usage results are available as JSON so their coverage and reasons stay with the rows.")}</p>
        {/if}
        <fieldset class="diagnostic-options">
            <legend>{translate("Report format")}</legend>
            <div class="diagnostic-option-list">
                {#each output.artifacts as artifact}
                    <label>
                        <input type="radio" name="database-diagnostic-format" value={artifact.format} bind:group={selectedFormat} />
                        <span>{artifact.format.toUpperCase()}</span>
                    </label>
                {/each}
            </div>
        </fieldset>
        <textarea readonly rows="16" aria-label={translate("Diagnostic report")} value={selected?.content ?? ""}></textarea>
        <p role="status">{actionStatus}</p>
        <div class="diagnostic-controls">
            <button onclick={(event) => void copyReport(event)}>{translate("Copy report")}</button>
            <button onclick={saveReport}>{translate("Save report")}</button>
            <button onclick={() => setResult("close")}>{translate("Close")}</button>
        </div>
    {:else if phase === "failed"}
        <p role="status">{translate("The inspection could not finish. Close this dialogue and try again after database startup.")}</p>
        <button onclick={() => setResult("close")}>{translate("Close")}</button>
    {/if}
</div>

<style>
    .database-diagnostic { display: flex; flex-direction: column; gap: var(--size-4-2); }
    p { margin-block: var(--size-4-2); }
    .diagnostic-options { border: 0; margin: 0; padding: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: var(--size-4-2); }
    .diagnostic-option-list { display: flex; flex-wrap: wrap; gap: var(--size-4-2) var(--size-4-4); }
    .diagnostic-option-list label { display: flex; align-items: center; gap: var(--size-4-2); width: auto; min-height: 44px; cursor: pointer; }
    .database-diagnostic .diagnostic-option-list label > span { width: auto; }
    input[type="radio"] { margin: 0; flex: 0 0 auto; }
    .diagnostic-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--size-4-2); }
    button { min-height: 44px; }
    textarea { width: 100%; resize: vertical; font-family: var(--font-monospace); font-size: var(--font-ui-small); }
    :global(body.is-mobile) textarea { max-height: 25vh; }
</style>
