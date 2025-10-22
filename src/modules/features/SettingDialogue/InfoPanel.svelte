<script lang="ts">
    /**
     * Info Panel to display key-value information from the port
     * Mostly used in the Setting Dialogue
     */
    import { type SveltePanelProps } from "./SveltePanel";
    type Props = SveltePanelProps<{
        info: Record<string, any>;
    }>;
    const { port }: Props = $props();
    const info = $derived.by(() => $port?.info ?? {});
    const infoEntries = $derived(Object.entries(info ?? {}));
</script>

<div class="info-panel">
    <div class="info-grid" role="list">
        {#each infoEntries as [key, value]}
            <div class="info-entry info-key" role="listitem" aria-label={key}>
                <div class="key">{key}</div>
            </div>
            <div class="info-entry info-item" role="listitem" aria-label={key}>
                <div class="value">{value}</div>
            </div>
        {/each}
    </div>
</div>

<style>
    .info-panel {
        padding: 0.6rem;
        flex-grow: 1;
    }

    /* Main Grid (Info Items) 220px to 1fr, repeat */
    .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 0.6rem;
        margin-top: 0.5rem;
    }
    .info-entry {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.5rem;
        border-radius: 6px;
        box-sizing: border-box;
        min-height: 1.2em;
    }

    .info-key {
        font-weight: 600;
        align-items: center;
        border-top: 1px solid var(--background-modifier-hover);
        border-bottom: 1px solid var(--background-modifier-hover);
        /* color: var(--text-muted, #6b6b6b); */
    }
    .info-item {
        align-items: start;
        padding: 0.5rem;
        background: var(--background-modifier-hover, rgba(0, 0, 0, 0.03));
    }

    .value {
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-normal, #e6e6e6);
        min-height: 1em;
    }

    @media (max-width: 420px) {
        .info-item {
            grid-template-columns: 1fr;
        }
        /* .label {
            order: -1;
            white-space: normal;
            padding-bottom: 0.25rem;
        } */
    }
</style>
