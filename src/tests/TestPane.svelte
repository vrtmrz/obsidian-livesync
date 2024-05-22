<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type ObsidianLiveSyncPlugin from "../main";
    import { perf_trench } from "./tests";
    import { MarkdownRenderer } from "../deps";
    export let plugin: ObsidianLiveSyncPlugin;
    let performanceTestResult = "";
    let functionCheckResult = "";
    let testRunning = false;
    let prefTestResultEl: HTMLDivElement;
    let isReady = false;
    $: {
        if (performanceTestResult != "" && isReady) {
            MarkdownRenderer.render(plugin.app, performanceTestResult, prefTestResultEl, "/", plugin);
        }
    }

    async function performTest() {
        try {
            testRunning = true;
            performanceTestResult = await perf_trench(plugin);
        } finally {
            testRunning = false;
        }
    }
    function clearPerfTestResult() {
        prefTestResultEl.empty();
    }
    onMount(() => {
        isReady = true;
        // performTest();
    });
</script>

<h2>TESTBENCH: Self-hosted LiveSync</h2>

<h3>Function check</h3>
<pre>{functionCheckResult}</pre>

<h3>Performance test</h3>
<button on:click={() => performTest()} disabled={testRunning}>Test!</button>
<button on:click={() => clearPerfTestResult()}>Clear</button>

<div bind:this={prefTestResultEl}></div>

<style>
    * {
        box-sizing: border-box;
    }
</style>
