<script lang="ts">
    import { setContext } from "svelte";

    type Props = {
        children?: () => any;
        question?: () => any;
    };
    const { children, question }: Props = $props();
    const questionGroupID = Math.random().toString(36).substring(2, 15);
    setContext("radioGroup", questionGroupID);
</script>

<div class="question-container">
    {#if question}<h3>{@render question?.()}</h3>{/if}
    <div class="question-content">
        {@render children?.()}
    </div>
</div>

<style>
    .question-container {
        border-bottom: 2px solid var(--interactive-accent);
        margin-bottom: 0.5lh;
        padding-bottom: 0.5lh;
    }
</style>
