<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { logMessages } from "../lib/src/mock_and_interop/stores";
    import type { ReactiveInstance } from "../lib/src/dataobject/reactive";
    import { Logger } from "../lib/src/common/logger";

    let unsubscribe: () => void;
    let messages = [] as string[];
    let wrapRight = false;
    let autoScroll = true;
    let suspended = false;
    function updateLog(logs: ReactiveInstance<string[]>) {
        const e = logs.value;
        if (!suspended) {
            messages = [...e];
            setTimeout(() => {
                if (scroll) scroll.scrollTop = scroll.scrollHeight;
            }, 10);
        }
    }
    onMount(async () => {
        logMessages.onChanged(updateLog);
        Logger("Log window opened");
        unsubscribe = () => logMessages.offChanged(updateLog);
    });
    onDestroy(() => {
        if (unsubscribe) unsubscribe();
    });
    let scroll: HTMLDivElement;
</script>

<div class="logpane">
    <!-- <h1>Self-hosted LiveSync Log</h1> -->
    <div class="control">
        <div class="row">
            <label><input type="checkbox" bind:checked={wrapRight} /><span>Wrap</span></label>
            <label><input type="checkbox" bind:checked={autoScroll} /><span>Auto scroll</span></label>
            <label><input type="checkbox" bind:checked={suspended} /><span>Pause</span></label>
        </div>
    </div>
    <div class="log" bind:this={scroll}>
        {#each messages as line}
            <pre class:wrap-right={wrapRight}>{line}</pre>
        {/each}
    </div>
</div>

<style>
    * {
        box-sizing: border-box;
    }
    .logpane {
        display: flex;
        height: 100%;
        flex-direction: column;
    }
    .log {
        overflow-y: scroll;
        user-select: text;
        padding-bottom: 2em;
    }
    .log > pre {
        margin: 0;
    }
    .log > pre.wrap-right {
        word-break: break-all;
        max-width: 100%;
        width: 100%;
        white-space: normal;
    }
    .row {
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
    }
    .row > label {
        display: flex;
        align-items: center;
        min-width: 5em;
        margin-right: 1em;
    }
</style>
