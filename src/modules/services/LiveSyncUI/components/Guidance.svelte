<script lang="ts">
    import { translateIfAvailable as translate } from "@/common/translation";

    type Props = {
        children?: () => any;
        important?: boolean;
        title?: string;
    };
    const { children, important, title }: Props = $props();
    const cssClass = $derived.by(() => {
        return important ? "guidance important" : "guidance";
    });
    const translatedTitle = $derived.by(() => (title ? translate(title) : ""));
</script>

<div class={cssClass}>
    {#if translatedTitle}
        <h3>{translatedTitle}</h3>
    {/if}
    {@render children?.()}
</div>
