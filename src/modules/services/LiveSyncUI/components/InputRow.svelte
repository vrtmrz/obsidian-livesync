<script lang="ts">
    import { translateIfAvailable as translate } from "@/common/translation";

    type Props = {
        label: string;
        children?: () => any;
    };
    const { label, children }: Props = $props();
    const translatedLabel = $derived.by(() => translate(label));
</script>

<label class="row"
    ><span>{translatedLabel}</span>
    {@render children?.()}
</label>
