<script lang="ts">
    type Props = {
        info: Record<string, any>;
    };
    const { info }: Props = $props();
    const infoEntries = $derived.by(() => Object.entries(info ?? {}));
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

    /* Main Grid (Info Items) 120px to 1fr, repeat */
    .info-grid {
        display: grid;
        grid-template-columns:  minmax(120px, 1fr) 1fr;
        column-count: 2;
        gap: 0.6rem;
        margin-top: 0.5rem;
        grid-area: "info-key" "info-value";
    }
    .info-entry {
        display: grid;
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
        grid-area: "info-key";
    }
    .info-item {
        align-items: start;
        padding: 0.5rem;
        background: var(--background-modifier-hover, rgba(0, 0, 0, 0.03));
        grid-area: "info-value";
    }

    .value {
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-normal, #e6e6e6);
        min-height: 1em;
    }

    @container (max-width: 340px) {
        .info-grid {
            grid-template-columns: 1fr;
        }
        .info-item {
            grid-template-columns: 1fr;
        }
    }
</style>
