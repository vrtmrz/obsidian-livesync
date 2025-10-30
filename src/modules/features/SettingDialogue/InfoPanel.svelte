<script lang="ts">
    /**
     * Info Panel to display key-value information from the port
     * Mostly used in the Setting Dialogue
     */
    import { type SveltePanelProps } from "./SveltePanel";
    import InfoTable from "@lib/ui/components/InfoTable.svelte";
    type Props = SveltePanelProps<{
        info: Record<string, any>;
    }>;
    const { port }: Props = $props();
    const info = $derived.by(() => $port?.info ?? {});
</script>

<InfoTable {info} />
