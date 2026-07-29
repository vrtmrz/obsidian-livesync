<script lang="ts">
    import P2PReplicatorPane from "@/features/P2PSync/P2PReplicator/P2PReplicatorPane.svelte";
    import BrowserP2PTransportSettings from "@/apps/browser/BrowserP2PTransportSettings.svelte";
    import type { WebAppRuntime } from "./WebAppRuntime";

    interface Props {
        runtime: WebAppRuntime;
    }

    let { runtime }: Props = $props();
    let isScanning = $state(false);
    let scanStatus = $state("");

    async function scanLocalFiles() {
        isScanning = true;
        scanStatus = "Scanning local files…";
        try {
            scanStatus = (await runtime.scanLocalFiles())
                ? "Local files are ready for synchronisation."
                : "The local file scan could not be completed.";
        } catch (error) {
            scanStatus = `The local file scan failed: ${String(error)}`;
        } finally {
            isScanning = false;
        }
    }
</script>

<div class="local-file-actions">
    <button type="button" disabled={isScanning} onclick={scanLocalFiles}>Scan local files</button>
    <span role="status" aria-live="polite">{scanStatus}</span>
</div>

<BrowserP2PTransportSettings host={runtime.p2pPaneHost} />
<P2PReplicatorPane
    host={runtime.p2pPaneHost}
/>

<style>
    .local-file-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 1rem;
    }
</style>
