<script lang="ts">
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import { $msg as translateMessage } from "@/common/translation";
</script>

<InfoNote warning>
    {translateMessage(
        "Accepting unencrypted content will be enabled. Third-party tools can add content without the E2EE passphrase. Anyone with database write access can inject plaintext. This affects received content only; content sent by this plug-in remains encrypted."
    )}
</InfoNote>
