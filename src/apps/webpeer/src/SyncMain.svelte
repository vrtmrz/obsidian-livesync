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

<svelte:head>
    <meta name="theme-color" content="#12233f" />
</svelte:head>

<main class="webpeer-shell">
    <header class="webpeer-header">
        <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true"><span></span></span>
            <span>
                <small>Self-hosted LiveSync</small>
                <strong>WebPeer</strong>
                <span class="brand-description">A browser-hosted peer for temporary P2P transfers.</span>
            </span>
        </div>

        <a
            class="connection-check-link"
            href="./check.html"
            aria-label="Try the P2P connection check"
        >
            <span class="check-mark" aria-hidden="true">◇</span>
            <span>
                <small>Disposable connectivity check</small>
                <strong>Try the P2P connection check</strong>
            </span>
            <span class="check-arrow" aria-hidden="true">→</span>
        </a>
    </header>

    <div class="workspace-grid">
        <section class="workspace-card control-card" aria-label="WebPeer controls">
            <div class="panel-meta">
                <p>Browser peer controls</p>
                <span>Stored in this browser</span>
            </div>

            {#await synchronised then activeRuntime}
                <P2PReplicatorPane host={activeRuntime.paneHost}></P2PReplicatorPane>
                <BrowserP2PTransportSettings host={activeRuntime.paneHost} />
            {:catch error}
                <div class="runtime-error" role="alert">
                    <strong>WebPeer could not start</strong>
                    <p>{error instanceof Error ? error.message : String(error)}</p>
                </div>
            {/await}
        </section>

        <aside class="workspace-card log-card" aria-labelledby="activity-heading">
            <header class="log-header">
                <div>
                    <p class="section-kicker">Live diagnostics</p>
                    <h2 id="activity-heading">Activity log</h2>
                </div>
                <div class="status-pill" aria-live="polite">
                    <span aria-hidden="true"></span>
                    {statusLine || "Initialising"}
                </div>
            </header>

            <div
                class="logslist"
                bind:this={elP}
                role="log"
                aria-label="WebPeer activity log"
            >
                {#if $logs.length === 0}
                    <p class="empty-log">Waiting for peer activity.</p>
                {:else}
                    {#each $logs as log}
                        <p class="log-entry">{log}</p>
                    {/each}
                {/if}
            </div>
        </aside>
    </div>

    <footer class="webpeer-footer">
        WebPeer is experimental browser software. Keep this page open while it is connected or
        transferring changes.
    </footer>
</main>
