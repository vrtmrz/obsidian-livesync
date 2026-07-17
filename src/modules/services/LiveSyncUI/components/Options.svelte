<script lang="ts">
    import { setContext } from "svelte";

    type Props = {
        children?: () => any;
    };
    const { children }: Props = $props();
    const questionGroupID = Math.random().toString(36).substring(2, 15);
    setContext("radioGroup", questionGroupID);
</script>

<div class="options-container">
    {@render children?.()}
</div>
