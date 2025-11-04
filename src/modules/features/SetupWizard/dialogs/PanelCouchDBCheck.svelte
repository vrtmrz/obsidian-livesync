<script lang="ts">
    /**
     * Panel to check and fix CouchDB configuration issues
     */
    import type { ObsidianLiveSyncSettings } from "../../../../lib/src/common/types";
    import Decision from "../../../../lib/src/UI/components/Decision.svelte";
    import UserDecisions from "../../../../lib/src/UI/components/UserDecisions.svelte";
    import { checkConfig, type ConfigCheckResult, type ResultError, type ResultErrorMessage } from "./utilCheckCouchDB";
    type Props = {
        trialRemoteSetting: ObsidianLiveSyncSettings;
    };
    const { trialRemoteSetting }: Props = $props();
    let detectedIssues = $state<ConfigCheckResult[]>([]);
    async function testAndFixSettings() {
        detectedIssues = [];
        try {
            const fixResults = await checkConfig(trialRemoteSetting);
            console.dir(fixResults);
            detectedIssues = fixResults;
        } catch (e) {
            console.error("Error during testAndFixSettings:", e);
            detectedIssues.push({ message: `Error during testAndFixSettings: ${e}`, result: "error", classes: [] });
        }
    }
    function isErrorResult(result: ConfigCheckResult): result is ResultError | ResultErrorMessage {
        return "result" in result && result.result === "error";
    }
    function isFixableError(result: ConfigCheckResult): result is ResultError {
        return isErrorResult(result) && "fix" in result && typeof result.fix === "function";
    }
    function isSuccessResult(result: ConfigCheckResult): result is { message: string; result: "ok"; value?: any } {
        return "result" in result && result.result === "ok";
    }
    let processing = $state(false);
    async function fixIssue(issue: ResultError) {
        try {
            processing = true;
            await issue.fix();
        } catch (e) {
            console.error("Error during fixIssue:", e);
        }
        await testAndFixSettings();
        processing = false;
    }
    const errorIssueCount = $derived.by(() => {
        return detectedIssues.filter((issue) => isErrorResult(issue)).length;
    });
    const isAllSuccess = $derived.by(() => {
        return !(errorIssueCount > 0 && detectedIssues.length > 0);
    });

</script>

{#snippet result(issue: ConfigCheckResult)}
    <div class="check-result {isErrorResult(issue) ? 'error' : isSuccessResult(issue) ? 'success' : ''}">
        <div class="message">
            {issue.message}
        </div>
        {#if isFixableError(issue)}
            <div class="operations">
                <button onclick={() => fixIssue(issue)} class="mod-cta" disabled={processing}>Fix</button>
            </div>
        {/if}
    </div>
{/snippet}
<UserDecisions>
    <Decision title="Detect and Fix CouchDB Issues" important={true} commit={testAndFixSettings} />
</UserDecisions>
<div class="check-results">
    <details open={!isAllSuccess}>
        <summary>
            {#if detectedIssues.length === 0}
                No checks have been performed yet.
            {:else if isAllSuccess}
                All checks passed successfully!
            {:else}
                {errorIssueCount} issue(s) detected!
            {/if}
        </summary>
        {#if detectedIssues.length > 0}
            <h3>Issue detection log:</h3>
            {#each detectedIssues as issue}
                {@render result(issue)}
            {/each}
        {/if}
    </details>
</div>

<style>
    /* Make .check-result a CSS Grid: let .message expand and keep .operations at minimum width, aligned to the right */
    .check-results {
        /* Adjust spacing as required */
        margin-top: 0.75rem;
    }

    .check-result {
        display: grid;
        grid-template-columns: 1fr auto; /* message takes remaining space, operations use minimum width */
        align-items: center; /* vertically centre align */
        gap: 0.5rem 1rem;
        padding: 0rem 0.5rem;
        border-radius: 0;
        box-shadow: none;
        border-left: 0.5em solid var(--interactive-accent);
        margin-bottom: 0.25lh;
    }
    .check-result.error {
        border-left: 0.5em solid var(--text-error);
    }
    .check-result.success {
        border-left: 0.5em solid var(--text-success);
    }

    .check-result .message {
        /* Wrap long messages */
        white-space: normal;
        word-break: break-word;
        font-size: 0.95rem;
        color: var(--text-normal);
    }

    .check-result .operations {
        /* Centre the button(s) vertically and align to the right */
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    /* For small screens: move .operations below and stack vertically */
    @media (max-width: 520px) {
        .check-result {
            grid-template-columns: 1fr;
            grid-auto-rows: auto;
        }
        .check-result .operations {
            justify-content: flex-start;
            margin-top: 0.5rem;
        }
    }
</style>
