<script lang="ts">
    export type Props = {
        children?: () => any;
    };
    const { children }: Props = $props();
</script>

<div class="button-group">
    {#if children}
        {@render children()}
    {/if}
</div>
