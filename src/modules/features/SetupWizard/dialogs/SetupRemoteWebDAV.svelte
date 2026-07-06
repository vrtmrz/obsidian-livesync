<script lang="ts">
    import DialogHeader from "@lib/UI/components/DialogHeader.svelte";
    import Guidance from "@lib/UI/components/Guidance.svelte";
    import Decision from "@lib/UI/components/Decision.svelte";
    import UserDecisions from "@lib/UI/components/UserDecisions.svelte";
    import InfoNote from "@lib/UI/components/InfoNote.svelte";
    import InputRow from "@lib/UI/components/InputRow.svelte";
    import {
        DEFAULT_SETTINGS,
        PREFERRED_JOURNAL_SYNC,
        RemoteTypes,
        type ObsidianLiveSyncSettings,
        type WebDAVSyncSetting,
    } from "@lib/common/types";
    import { copyTo, pickWebDAVSyncSettings } from "@lib/common/utils";
    import { getDialogContext, type GuestDialogProps } from "@lib/UI/svelteDialog";
    import { onMount } from "svelte";
    import { TYPE_CANCELLED, type SetupRemoteWebDAVResultType } from "./setupDialogTypes";

    const default_setting = pickWebDAVSyncSettings(DEFAULT_SETTINGS);

    let syncSetting = $state<WebDAVSyncSetting>({ ...default_setting });

    type Props = GuestDialogProps<SetupRemoteWebDAVResultType, WebDAVSyncSetting>;

    const { setResult, getInitialData }: Props = $props();

    onMount(() => {
        if (getInitialData) {
            const initialData = getInitialData();
            if (initialData) {
                copyTo(initialData, syncSetting);
            }
        }
    });

    let error = $state("");
    let processing = $state(false);
    const context = getDialogContext();

    function parseURI(): URL | false {
        const match = syncSetting.webDAVactiveConnectionURI.trim().match(/^sls\+webdav:(.*)$/);
        if (!match) {
            return false;
        }
        try {
            return new URL(`https:${match[1]}`);
        } catch {
            return false;
        }
    }

    const parsedURI = $derived.by(() => parseURI());
    const canProceed = $derived.by(() => parsedURI !== false);
    const isInsecure = $derived.by(() => parsedURI !== false && parsedURI.searchParams.get("insecure") === "true");
    const usesInternalAPI = $derived.by(
        () => parsedURI !== false && parsedURI.searchParams.get("useProxy") === "true"
    );

    function generateSetting() {
        const trialSettings: WebDAVSyncSetting = {
            ...syncSetting,
            webDAVactiveConnectionURI: syncSetting.webDAVactiveConnectionURI.trim(),
        };
        const trialRemoteSetting: ObsidianLiveSyncSettings = {
            ...DEFAULT_SETTINGS,
            ...PREFERRED_JOURNAL_SYNC,
            remoteType: RemoteTypes.REMOTE_WEBDAV,
            ...trialSettings,
        };
        return trialRemoteSetting;
    }

    async function checkConnection() {
        try {
            processing = true;
            const trialRemoteSetting = generateSetting();
            const replicator = await context.services.replicator.getNewReplicator(trialRemoteSetting);
            if (!replicator) {
                return "Failed to create replicator instance.";
            }
            try {
                const result = await replicator.tryConnectRemote(trialRemoteSetting, false);
                if (result) {
                    return "";
                }
                return "Failed to connect to the server. Please check your settings.";
            } catch (e) {
                return `Failed to connect to the server: ${e}`;
            }
        } finally {
            processing = false;
        }
    }

    async function checkAndCommit() {
        error = "";
        try {
            error = (await checkConnection()) || "";
            if (!error) {
                setResult(pickWebDAVSyncSettings(generateSetting()));
                return;
            }
        } catch (e) {
            error = `Error during connection test: ${e}`;
        }
    }

    function commit() {
        setResult(pickWebDAVSyncSettings(generateSetting()));
    }

    function cancel() {
        setResult(TYPE_CANCELLED);
    }
</script>

<DialogHeader title="WebDAV Configuration" />
<Guidance>
    Please enter the WebDAV connection URI. This experimental setup stores Journal synchronisation files in a WebDAV
    collection.
</Guidance>

<InputRow label="Connection URI">
    <input
        type="text"
        name="webdav-connection-uri"
        placeholder="sls+webdav://user:password@example.com/dav?prefix=vault%2F"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.webDAVactiveConnectionURI}
    />
</InputRow>
<InfoNote>
    Use `sls+webdav://user:password@host/path`. Optional query parameters include `prefix`, `useProxy=true`, and
    `insecure=true` for local HTTP testing.
</InfoNote>
<InfoNote warning visible={isInsecure}>Secure HTTPS connections are required on Obsidian Mobile.</InfoNote>
<InfoNote visible={usesInternalAPI}>
    This connection uses Obsidian's internal API. It can help when direct WebDAV requests are blocked by CORS.
</InfoNote>
<InfoNote error visible={syncSetting.webDAVactiveConnectionURI.trim() !== "" && !canProceed}>
    The connection URI must start with `sls+webdav://`.
</InfoNote>

<InfoNote error visible={error !== ""}>
    {error}
</InfoNote>

{#if processing}
    Checking connection... Please wait.
{:else}
    <UserDecisions>
        <Decision title="Test Settings and Continue" important disabled={!canProceed} commit={() => checkAndCommit()} />
        <Decision title="Continue anyway" disabled={!canProceed} commit={() => commit()} />
        <Decision title="Cancel" commit={() => cancel()} />
    </UserDecisions>
{/if}
