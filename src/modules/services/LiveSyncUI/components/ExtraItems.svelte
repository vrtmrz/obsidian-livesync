<script lang="ts">
    import { translateIfAvailable as translate } from "@vrtmrz/livesync-commonlib/compat/common/i18n";

    type Props = {
        title?: string;
        children?: () => any;
    };
    const { children, title }: Props = $props();
    const translatedTitle = $derived.by(() => (title ? translate(title) : ""));
</script>

<details>
    <summary>{translatedTitle}</summary>
    <div class="sub-section">
        {@render children?.()}
    </div>
</details>
