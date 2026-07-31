<script lang="ts">
    import { logs } from "./WebPeerLogs";
    import BrowserP2PTransportSettings from "@/apps/browser/BrowserP2PTransportSettings.svelte";
    import P2PReplicatorPane from "@/features/P2PSync/P2PReplicator/P2PReplicatorPane.svelte";
    import { onMount, tick } from "svelte";
    import { WebPeerRuntime } from "./WebPeerRuntime";

    const runtime = new WebPeerRuntime();
    const synchronised = runtime.start();
    let elP: HTMLDivElement;
    let statusLine = $state(runtime.statusLine.value);

    onMount(() => {
        const onStatusLineChanged = (line: { readonly value: string }) => {
            statusLine = line.value;
        };
        runtime.statusLine.onChanged(onStatusLineChanged);
        const unsubscribeLogs = logs.subscribe(() => {
            void tick().then(() => elP?.scrollTo({ top: elP.scrollHeight }));
        });
        return () => {
            runtime.statusLine.offChanged(onStatusLineChanged);
            unsubscribeLogs();
            void runtime.shutdown();
        };
    });
</script>

<main>
    <div class="control">
        <div class="connection-check-link">
            <a href="./check.html">Try the P2P connection check</a>
        </div>
        {#await synchronised then activeRuntime}
            <BrowserP2PTransportSettings host={activeRuntime.paneHost} />
            <P2PReplicatorPane host={activeRuntime.paneHost}></P2PReplicatorPane>
        {:catch error}
            <p>{error instanceof Error ? error.message : String(error)}</p>
        {/await}
    </div>
    <div class="log">
        <div class="status">
            {statusLine}
        </div>
        <div class="logslist" bind:this={elP}>
            {#each $logs as log}
                <p>{log}</p>
            {/each}
        </div>
    </div>
</main>

<style>
    main {
        display: flex;
        flex-direction: row;
        flex-grow: 1;
        max-height: 100vh;
        box-sizing: border-box;
    }
    @media (max-width: 900px) {
        main {
            flex-direction: column;
        }
    }
    @media (device-orientation: portrait) {
        main {
            flex-direction: column;
        }
    }
    .log {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        padding: 1em;
        min-width: 50%;
    }
    @media (max-width: 900px) {
        .log {
            max-height: 50vh;
        }
    }
    @media (device-orientation: portrait) {
        .log {
            max-height: 50vh;
        }
    }
    .control {
        padding: 1em 1em;
        overflow-y: scroll;
        flex-grow: 1;
    }
    .connection-check-link {
        margin-bottom: 0.75em;
        text-align: left;
    }
    .connection-check-link a {
        display: inline-block;
        padding: 0.45em 0.75em;
        border: 1px solid var(--interactive-accent);
        border-radius: 0.5em;
        color: var(--interactive-accent);
        text-decoration: none;
    }
    .connection-check-link a:hover {
        color: var(--interactive-accent-hover);
        border-color: var(--interactive-accent-hover);
    }
    .status {
        flex-grow: 0;
        /* max-height: 40px; */
        /* height: 40px; */
        flex-shrink: 0;
    }
    .logslist {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        /* padding: 1em; */
        width: 100%;
        overflow-y: scroll;
        flex-grow: 1;
        flex-shrink: 1;
        /* max-height: calc(100% - 40px); */
    }
    p {
        margin: 0;
        white-space: pre-wrap;
        text-align: left;
        word-break: break-all;
    }
</style>
