<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import { $msg as translate } from "@/common/translation";
    import type {
        DiagnosticFileCandidate,
        DiagnosticFileLookupDialogOptions,
        DiagnosticFileLookupResult,
    } from "@/serviceFeatures/diagnosticFileLookupTypes";
    import type { DatabaseDiagnosticOutput } from "@/serviceFeatures/databaseDiagnostics";

    const { setResult, getInitialData }: GuestDialogProps<"close", DiagnosticFileLookupDialogOptions> = $props();
    let options = $state<DiagnosticFileLookupDialogOptions>();
    let phase = $state<"input" | "running" | "results" | "report">("input");
    let token = $state("");
    let completedToken = $state<string>();
    let processed = $state(0);
    let cancelling = $state(false);
    let preparingReport = $state(false);
    let lookupResult = $state<DiagnosticFileLookupResult>();
    let output = $state<DatabaseDiagnosticOutput>();
    let selectedFormat = $state("");
    let actionStatus = $state("");
    let thisElement: HTMLDivElement;
    let disposed = false;
    const title = translate("Find a file from a report pseudonym");
    const selected = $derived(output?.artifacts.find((artifact) => artifact.format === selectedFormat));
    const lookupStatus = $derived.by(() => {
        if (phase === "running") {
            return cancelling
                ? translate("Cancelling local search. Checked ${COUNT} entries.", { COUNT: `${processed}` })
                : translate("Checked ${COUNT} local entries.", { COUNT: `${processed}` });
        }
        if (!lookupResult) return "";
        if (!lookupResult.valid) return translate("Enter a valid report path pseudonym.");
        if (lookupResult.status === "cancelled") return translate("Search cancelled. Matches found so far are shown.");
        if (lookupResult.candidates.length === 0) {
            return translate(
                "No matches were found in current Vault paths or current local Metadata. Older history and remote-only files are not searched."
            );
        }
        return translate("Found ${COUNT} local matches.", { COUNT: `${lookupResult.candidates.length}` });
    });

    onMount(() => {
        options = getInitialData?.();
        const modalContainer = thisElement.closest(".modal-container");
        const alreadyScoped = modalContainer?.classList.contains("sls-diagnostic-file-lookup-modal") ?? false;
        modalContainer?.classList.add("sls-diagnostic-file-lookup-modal");
        return () => {
            if (!alreadyScoped) modalContainer?.classList.remove("sls-diagnostic-file-lookup-modal");
        };
    });

    onDestroy(() => {
        disposed = true;
        options?.cancel();
    });

    async function findFiles(event?: SubmitEvent) {
        event?.preventDefault();
        const dialogOptions = options;
        if (!dialogOptions || phase === "running" || preparingReport) return;
        phase = "running";
        cancelling = false;
        processed = 0;
        lookupResult = undefined;
        completedToken = undefined;
        output = undefined;
        actionStatus = "";
        const searchedToken = token;
        try {
            const result = await dialogOptions.find(searchedToken, (count) => {
                if (!disposed) processed = count;
            });
            if (disposed) return;
            lookupResult = result;
            completedToken = result.valid ? searchedToken : undefined;
            phase = result.valid ? "results" : "input";
        } catch {
            if (!disposed) {
                completedToken = undefined;
                phase = "input";
                actionStatus = translate("The local search could not finish.");
            }
        }
    }

    function updateToken(event: Event) {
        token = (event.currentTarget as HTMLInputElement).value;
        if (phase === "results") {
            lookupResult = undefined;
            completedToken = undefined;
            phase = "input";
            actionStatus = "";
        }
    }

    function cancelSearch() {
        cancelling = true;
        options?.cancel();
    }

    async function openCandidate(candidate: DiagnosticFileCandidate) {
        if (!options?.openFile || !candidate.storageExists) return;
        try {
            await options.openFile(candidate.path);
        } catch {
            actionStatus = translate("The file could not be opened.");
        }
    }

    async function prepareReport(candidate: DiagnosticFileCandidate) {
        const reportToken = completedToken;
        if (!options || !reportToken || preparingReport || phase !== "results") return;
        preparingReport = true;
        actionStatus = "";
        try {
            const report = await options.prepareReport(candidate, reportToken);
            if (disposed) return;
            output = report;
            selectedFormat = report.artifacts[0]?.format ?? "";
            phase = "report";
        } catch {
            if (!disposed) actionStatus = translate("The follow-up report could not be prepared.");
        } finally {
            if (!disposed) preparingReport = false;
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
<div class="diagnostic-file-lookup" bind:this={thisElement} data-diagnostic-phase={phase}>
    {#if phase !== "report"}
        {#if phase !== "results"}
            <p>
                {translate("Search current Vault paths and current local Metadata only. Older history and remote-only files are not searched.")}
            </p>
            <p>
                {translate(
                    "The lookup does not read file contents or contact a remote database. Follow-up reports include current conflicts and merge bases."
                )}
            </p>
        {/if}

        <form class="lookup-form" onsubmit={findFiles}>
            <label for="diagnostic-file-lookup-token">{translate("Report path pseudonym")}</label>
            <input
                id="diagnostic-file-lookup-token"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                disabled={phase === "running" || preparingReport}
                value={token}
                oninput={updateToken}
            />
            <div class="lookup-controls">
                <button
                    type="submit"
                    class="mod-cta"
                    disabled={!options || phase === "running" || preparingReport}
                >
                    {translate("Find file")}
                </button>
                {#if phase === "running"}
                    <button type="button" disabled={cancelling} onclick={cancelSearch}>{translate("Cancel")}</button>
                {/if}
                <button type="button" onclick={() => setResult("close")}>{translate("Close")}</button>
            </div>
        </form>
    {:else if completedToken}
        <p class="report-token"><span>{translate("Report path pseudonym")}</span>: <code>{completedToken}</code></p>
    {/if}

    {#if phase === "input" && actionStatus}
        <p role="status">{actionStatus}</p>
    {/if}

    {#if phase === "running"}
        <p role="status" aria-live="polite">{lookupStatus}</p>
    {:else if phase === "input" && lookupResult?.valid === false}
        <p role="status">{lookupStatus}</p>
    {:else if phase === "results" && lookupResult?.valid}
        <p role="status" aria-live="polite">{lookupStatus}</p>
        {#if lookupResult.candidates.length > 0}
            <ul class="lookup-candidates">
                {#each lookupResult.candidates as candidate}
                    <li
                        data-diagnostic-candidate="true"
                        data-document-id={candidate.documentId}
                        data-source={candidate.source}
                        data-storage-exists={candidate.storageExists}
                    >
                        <div class="candidate-details">
                            <strong>{candidate.path}</strong>
                            <dl>
                                <dt>{translate("Source")}</dt>
                                <dd>{candidate.source === "metadata" ? translate("Metadata") : translate("Vault")}</dd>
                                <dt>{translate("Metadata document ID")}</dt>
                                <dd>{candidate.documentId ?? translate("No current Metadata document")}</dd>
                                <dt>{translate("Current Vault file")}</dt>
                                <dd>{candidate.storageExists ? translate("Present") : translate("Missing")}</dd>
                            </dl>
                        </div>
                        <div class="candidate-controls">
                            <button
                                type="button"
                                disabled={!options?.openFile || !candidate.storageExists || preparingReport}
                                onclick={() => void openCandidate(candidate)}
                            >
                                {translate("Open file")}
                            </button>
                            <button
                                type="button"
                                class="mod-cta"
                                disabled={preparingReport}
                                onclick={() => void prepareReport(candidate)}
                            >
                                {translate("Prepare follow-up report")}
                            </button>
                        </div>
                    </li>
                {/each}
            </ul>
        {/if}
        <p role="status">{preparingReport ? translate("Preparing follow-up report…") : actionStatus}</p>
    {:else if phase === "report" && output}
        <p role="status">{translate("This report uses pseudonyms. Review its coverage before sharing.")}</p>
        <fieldset class="report-formats">
            <legend>{translate("Report format")}</legend>
            <div class="format-options">
                {#each output.artifacts as artifact}
                    <label>
                        <input type="radio" name="diagnostic-file-report-format" value={artifact.format} bind:group={selectedFormat} />
                        <span>{artifact.format.toUpperCase()}</span>
                    </label>
                {/each}
            </div>
        </fieldset>
        <textarea readonly rows="16" aria-label={translate("Diagnostic report")} value={selected?.content ?? ""}></textarea>
        <p role="status">{actionStatus}</p>
        <div class="lookup-controls">
            <button type="button" onclick={(event) => void copyReport(event)}>{translate("Copy report")}</button>
            <button type="button" onclick={saveReport}>{translate("Save report")}</button>
            <button type="button" onclick={() => { output = undefined; phase = "results"; }}>{translate("Back to matches")}</button>
            <button type="button" onclick={() => setResult("close")}>{translate("Close")}</button>
        </div>
    {/if}
</div>

<style>
    :global(.sls-diagnostic-file-lookup-modal .modal) {
        display: flex;
        flex-direction: column;
    }
    :global(.sls-diagnostic-file-lookup-modal .modal-title) { flex: 0 0 auto; }
    :global(.sls-diagnostic-file-lookup-modal .modal-content) {
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    :global(.sls-diagnostic-file-lookup-modal .modal-content > .dialog-host) {
        flex: 1 1 auto;
        min-height: 0;
    }
    .diagnostic-file-lookup {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--size-4-2);
        min-height: 0;
    }
    .diagnostic-file-lookup > p,
    .diagnostic-file-lookup form,
    .lookup-controls,
    .candidate-controls,
    .report-formats { flex: 0 0 auto; }
    p { margin: 0; }
    .lookup-form { display: flex; flex-direction: column; gap: var(--size-4-2); }
    .lookup-form label { min-height: 24px; }
    .lookup-form input { width: 100%; min-height: 44px; }
    .lookup-controls,
    .candidate-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--size-4-2);
    }
    .diagnostic-file-lookup button { min-height: 44px; max-width: 100%; margin-left: 0; white-space: normal; }
    .candidate-controls { min-width: 0; max-width: 100%; }
    .lookup-candidates {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: var(--size-4-2);
        min-height: 0;
        margin: 0;
        overflow: auto;
        padding: 0;
        list-style: none;
    }
    .lookup-candidates li {
        display: flex;
        flex: 0 0 auto;
        flex-wrap: wrap;
        min-width: 0;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--size-4-2);
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--radius-m);
        padding: var(--size-4-2);
    }
    .candidate-details { flex: 1 1 18rem; min-width: 0; }
    .candidate-details strong { display: block; overflow-wrap: anywhere; }
    dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--size-4-1) var(--size-4-2); margin: var(--size-4-2) 0 0; }
    dt { font-weight: var(--font-semibold); }
    dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .report-formats { border: 0; margin: 0; padding: 0; min-width: 0; }
    .report-token { overflow-wrap: anywhere; }
    .report-token code { white-space: normal; }
    legend { padding: 0; margin-bottom: var(--size-4-2); }
    .format-options { display: flex; flex-wrap: wrap; gap: var(--size-4-2) var(--size-4-4); }
    .format-options label { display: flex; align-items: center; gap: var(--size-4-2); width: auto; min-height: 44px; cursor: pointer; }
    .diagnostic-file-lookup .format-options label > span { width: auto; }
    input[type="radio"] { margin: 0; flex: 0 0 auto; }
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
    @media (max-width: 480px) {
        dl { grid-template-columns: minmax(0, 1fr); }
    }
</style>
