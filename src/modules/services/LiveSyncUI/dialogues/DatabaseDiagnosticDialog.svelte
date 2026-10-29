<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import type { GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import { $msg as translate } from "@/common/translation";
    import { ProgressFragment } from "@vrtmrz/obsidian-plugin-kit/progress";
    import type { DatabaseDiagnosticDialogOptions } from "@/serviceFeatures/databaseDiagnosticDialogTypes";
    import type {
        DatabaseDiagnosticOutput,
        DatabaseDiagnosticProgress,
    } from "@/serviceFeatures/databaseDiagnostics";
    import type { DiagnosticNameMode } from "@vrtmrz/livesync-commonlib/diagnostics";

    const { setResult, getInitialData }: GuestDialogProps<"close", DatabaseDiagnosticDialogOptions> = $props();
    let options = $state<DatabaseDiagnosticDialogOptions>();
    let phase = $state<"choice" | "running" | "result" | "failed">("choice");
    let nameMode = $state<DiagnosticNameMode>("pseudonym");
    let includeRemote = $state(true);
    let cancelling = $state(false);
    let output = $state<DatabaseDiagnosticOutput>();
    let selectedFormat = $state("");
    let actionStatus = $state("");
    let thisElement: HTMLDivElement;
    let progressHost = $state<HTMLDivElement>();
    let currentProgress: DatabaseDiagnosticProgress | undefined;
    let progressFragment: ProgressFragment | undefined;
    let lastProgressRender = 0;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
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
        const modalContainer = thisElement.closest(".modal-container");
        const alreadyScoped = modalContainer?.classList.contains("sls-database-diagnostic-modal") ?? false;
        modalContainer?.classList.add("sls-database-diagnostic-modal");
        return () => {
            if (!alreadyScoped) modalContainer?.classList.remove("sls-database-diagnostic-modal");
        };
    });
    onDestroy(() => {
        disposed = true;
        clearTimeout(progressTimer);
        options?.cancel();
    });

    async function begin() {
        const diagnosticOptions = options;
        if (!diagnosticOptions || phase !== "choice") return;
        phase = "running";
        await tick();
        if (disposed) return;
        currentProgress = undefined;
        progressFragment = undefined;
        progressHost?.replaceChildren();
        updateProgress({
            phase: diagnosticOptions.kind === "usage" ? "usage" : "metadata",
            source: diagnosticOptions.kind === "integrity" ? "local" : undefined,
            processed: 0,
            elapsedMs: 0,
        });
        try {
            const result = await diagnosticOptions.run(
                nameMode,
                (progress) => {
                    if (!disposed) updateProgress(progress);
                },
                includeRemote
            );
            if (disposed) return;
            finishProgress(result.status);
            output = result;
            selectedFormat = result.artifacts[0].format;
            phase = "result";
        } catch {
            if (!disposed) phase = "failed";
        }
    }

    function finishProgress(status: DatabaseDiagnosticOutput["status"]) {
        if (status === "cancelled") progressFragment?.cancel();
        else progressFragment?.complete();
    }

    function updateProgress(progress: DatabaseDiagnosticProgress, force = false) {
        const host = progressHost;
        if (!host) return;
        const stageChanged =
            currentProgress?.phase !== progress.phase || currentProgress?.source !== progress.source;
        const stageFinished =
            progress.totalIsFinal !== false && progress.total !== undefined && progress.processed === progress.total;
        currentProgress = progress;
        const now = performance.now();
        if (!force && !stageChanged && !stageFinished && now - lastProgressRender < 100) {
            progressTimer ??= setTimeout(() => {
                progressTimer = undefined;
                if (!disposed && phase === "running" && currentProgress) updateProgress(currentProgress, true);
            }, 100 - (now - lastProgressRender));
            return;
        }
        clearTimeout(progressTimer);
        progressTimer = undefined;
        lastProgressRender = now;
        const phaseTitle =
            progress.phase === "usage" ? translate("Reading revisions") :
            progress.phase === "accounting" ? translate("Calculating database usage") :
            progress.phase === "metadata" ? "Metadata" : "Content";
        const sourceTitle = progress.source ? ` · ${progress.source}` : "";
        const unit = progress.phase === "usage" ? "revisions" :
            progress.phase === "accounting" ? "items" : progress.phase === "metadata" ? "documents" : "groups";
        const total = progress.total ?? 0;
        const note = `${(progress.elapsedMs / 1000).toFixed(1)} s elapsed${
            progress.totalIsFinal === false ? ` · ${translate("Discovering revisions")}` : ""
        }`;
        if (stageChanged) {
            progressFragment?.complete();
            progressFragment = new ProgressFragment({
                value: progress.processed,
                total,
                title: `${phaseTitle}${sourceTitle}`,
                note,
                autoComplete: false,
                document: host.ownerDocument,
                formatNumeric: (snapshot) => `${snapshot.value} / ${currentProgress?.total === undefined ? "—" : snapshot.total} ${unit}`,
            });
            host.replaceChildren(progressFragment.fragment);
            return;
        }
        progressFragment?.update({ value: progress.processed, total, title: `${phaseTitle}${sourceTitle}`, note });
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
<div class="database-diagnostic" bind:this={thisElement} data-diagnostic-phase={phase}>
    {#if phase === "choice"}
        <p>{translate("Pseudonyms include a public salt, so guessed paths can be checked. Original names include private filenames. Reports omit file contents and credentials.")}</p>
        <p>
            {options?.kind === "usage"
                ? translate("Read available local revisions and report their Chunk references. Settings are left unchanged.")
                : translate("Inspect normal-file Metadata, current conflicts, and suspect content against the Vault. Remote inspection supports CouchDB. Older history is excluded; findings do not authorise deletion.")}
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
        {#if options?.kind === "integrity"}
            <label class="diagnostic-remote-choice">
                <input type="checkbox" bind:checked={includeRemote} />
                <span>{translate("Include remote database")}</span>
            </label>
        {/if}
        <div class="diagnostic-controls">
            <button onclick={() => setResult("close")}>{translate("Cancel")}</button>
            <button class="mod-cta" disabled={!options} onclick={() => void begin()}>{translate("Begin inspection")}</button>
        </div>
    {:else if phase === "running"}
        <div class="diagnostic-progress" role="status" aria-live="polite" bind:this={progressHost}></div>
        {#if cancelling}
            <p role="status">{translate("Cancelling inspection…")}</p>
        {/if}
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
    :global(.sls-database-diagnostic-modal .modal) {
        display: flex;
        flex-direction: column;
    }
    :global(.sls-database-diagnostic-modal .modal-title) { flex: 0 0 auto; }
    :global(.sls-database-diagnostic-modal .modal-content) {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    :global(.sls-database-diagnostic-modal .modal-content > .dialog-host) {
        flex: 1 1 auto;
        min-height: 0;
    }
    .database-diagnostic {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--size-4-2);
        min-height: 0;
    }
    .database-diagnostic > :not(textarea) { flex: 0 0 auto; }
    p { margin: 0; }
    .diagnostic-options { border: 0; margin: 0; padding: 0; min-width: 0; }
    legend { padding: 0; margin-bottom: var(--size-4-2); }
    .diagnostic-option-list { display: flex; flex-wrap: wrap; gap: var(--size-4-2) var(--size-4-4); }
    .diagnostic-option-list label { display: flex; align-items: center; gap: var(--size-4-2); width: auto; min-height: 44px; cursor: pointer; }
    .database-diagnostic .diagnostic-option-list label > span { width: auto; }
    input[type="radio"] { margin: 0; flex: 0 0 auto; }
    .diagnostic-remote-choice { display: flex; align-items: center; gap: var(--size-4-2); min-height: 44px; cursor: pointer; }
    .database-diagnostic .diagnostic-remote-choice > span { width: auto; }
    input[type="checkbox"] { margin: 0; flex: 0 0 auto; }
    .diagnostic-controls { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: var(--size-4-2); }
    button { min-height: 44px; }
    textarea {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        width: 100%;
        resize: vertical;
        font-family: var(--font-monospace);
        font-size: var(--font-ui-small);
    }
    :global(body.is-mobile) textarea { max-height: 25vh; }
</style>
