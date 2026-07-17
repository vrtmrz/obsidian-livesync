<script lang="ts">
    import { getContext } from "svelte";
    import { translateIfAvailable as translate } from "@vrtmrz/livesync-commonlib/compat/common/i18n";

    type Props = {
        title: string;
        value: string;
        selectedValue: string;
        noteOnSelected?: () => any;
        noteOnUnselected?: () => any;
        group?: string;
        children?: () => any;
    };
    const definedGroupContext = getContext<string>("radioGroup");

    let {
        title,
        value = $bindable(),
        noteOnSelected,
        noteOnUnselected,
        selectedValue,
        group,
        children,
    }: Props = $props();
    const actualGroup = group ?? definedGroupContext;
    const translatedTitle = $derived.by(() => translate(title));
</script>

<div class="option-container {value === selectedValue ? 'selected' : ''}">
    <label>
        <div class="choice-row">
            <input type="radio" bind:group={value} name={actualGroup} value={selectedValue} />
            <span class="choice-title">{translatedTitle}</span>
        </div>
        <div class="choice-notes">
            {#if value === selectedValue && noteOnSelected}
                {@render noteOnSelected()}
            {:else if value !== selectedValue && noteOnUnselected}
                {@render noteOnUnselected()}
            {/if}
            {@render children?.()}
        </div>
    </label>
</div>

<style>
    .option-container {
        border: 1px solid transparent;
        border-radius: 0.25lh;
        padding: 0.5rem;
    }
    .option-container.selected {
        border-color: var(--interactive-accent);
    }
    .choice-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        /* margin-top: 1rem; */
        cursor: pointer;
    }
    .choice-row span.choice-title {
        width: auto;
    }
    .choice-row input[type="radio"] {
        /* width: 1.2rem;
        height: 1.2rem; */
        cursor: pointer;
    }

    .choice-notes {
        margin-left: 2rem;
        margin-top: 0.25rem;
        color: var(--text-muted);
        font-size: 0.9rem;
    }

    .option-container.selected .choice-notes {
        color: var(--text-normal);
    }
</style>
