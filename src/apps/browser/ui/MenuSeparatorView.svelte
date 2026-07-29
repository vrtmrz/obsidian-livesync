<script lang="ts">
    import type { MenuSeparator } from "@/apps/browser/BrowserMenu";

    type Props = {
        item: MenuSeparator;
    };
    const { item = $bindable() }: Props = $props();
</script>

<hr />
