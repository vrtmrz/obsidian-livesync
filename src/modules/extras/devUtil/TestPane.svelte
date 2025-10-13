<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type ObsidianLiveSyncPlugin from "../../../main.ts";
    import { perf_trench } from "./tests.ts";
    import { MarkdownRenderer, Notice } from "../../../deps.ts";
    import type { ModuleDev } from "../ModuleDev.ts";
    import { fireAndForget } from "octagonal-wheels/promises";
    import { EVENT_LAYOUT_READY, eventHub } from "../../../common/events.ts";
    import { writable } from "svelte/store";
    export let plugin: ObsidianLiveSyncPlugin;
    export let moduleDev: ModuleDev;
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
    function clearResult() {
        moduleDev.testResults.update((v) => {
            v = [];
            return v;
        });
    }
    function clearPerfTestResult() {
        prefTestResultEl.empty();
    }
    onMount(async () => {
        isReady = true;
        // performTest();

        eventHub.onceEvent(EVENT_LAYOUT_READY, async () => {
            if (await plugin.storageAccess.isExistsIncludeHidden("_AUTO_TEST.md")) {
                new Notice("Auto test file found, running tests...");
                fireAndForget(async () => {
                    await allTest();
                });
            } else {
                // new Notice("No auto test file found, skipping tests...");
            }
        });
    });

    let moduleTesting = false;
    function moduleMultiDeviceTest() {
        if (moduleTesting) return;
        moduleTesting = true;
        plugin.services.test.testMultiDevice().finally(() => {
            moduleTesting = false;
        });
    }
    function moduleSingleDeviceTest() {
        if (moduleTesting) return;
        moduleTesting = true;
        plugin.services.test.test().finally(() => {
            moduleTesting = false;
        });
    }
    async function allTest() {
        if (moduleTesting) return;
        moduleTesting = true;
        try {
            await plugin.services.test.test();
            await plugin.services.test.testMultiDevice();
        } finally {
            moduleTesting = false;
        }
    }

    const results = moduleDev.testResults;
    $: resultLines = $results;

    let syncStatus = [] as string[];
    eventHub.onEvent("debug-sync-status", (status) => {
        syncStatus = [...status];
    });
</script>

<h2>TESTING BENCH: Self-hosted LiveSync</h2>

<h3>Module Checks</h3>
<button on:click={() => moduleMultiDeviceTest()} disabled={moduleTesting}>MultiDevice Test</button>
<button on:click={() => moduleSingleDeviceTest()} disabled={moduleTesting}>SingleDevice Test</button>
<button on:click={() => allTest()} disabled={moduleTesting}>All Test</button>
<button on:click={() => clearResult()}>Clear</button>

{#each resultLines as [result, line, message]}
    <details open={!result}>
        <summary>[{result ? "PASS" : "FAILED"}] {line}</summary>
        <pre>{message}</pre>
    </details>
{/each}

<h3>Synchronisation Result Status</h3>
<pre>{syncStatus.join("\n")}</pre>

<h3>Performance test</h3>
<button on:click={() => performTest()} disabled={testRunning}>Test!</button>
<button on:click={() => clearPerfTestResult()}>Clear</button>

<div bind:this={prefTestResultEl}></div>

<style>
    * {
        box-sizing: border-box;
    }
</style>
