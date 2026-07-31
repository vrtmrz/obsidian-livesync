<script lang="ts">
    import { onMount } from "svelte";
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import ExtraItems from "@/modules/services/LiveSyncUI/components/ExtraItems.svelte";
    import InputRow from "@/modules/services/LiveSyncUI/components/InputRow.svelte";
    import Password from "@/modules/services/LiveSyncUI/components/Password.svelte";
    import { getDialogContext, type GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { DEFAULT_SETTINGS, PREFERRED_JOURNAL_SYNC, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/settings";
    import {
        REMOTE_WEBDAV,
        parseWebDAVConnectionURI,
        serialiseWebDAVConnectionURI,
        type WebDAVConnection,
        type WebDAVSyncSetting,
    } from "@vrtmrz/livesync-commonlib/journal-storage";
    import { TYPE_CANCELLED, type SetupRemoteWebDAVResultType } from "./setupDialogTypes";

    const connection = $state<WebDAVConnection>({
        endpoint: "",
        username: "",
        password: "",
        prefix: "",
        useCustomRequestHandler: false,
        customHeaders: "",
        journalFormat: "opaque-v1",
        expectedRepositoryId: "",
        packReadPolicy: "whole-pack",
    });

    type Props = GuestDialogProps<SetupRemoteWebDAVResultType, WebDAVSyncSetting>;
    const { setResult, getInitialData }: Props = $props();
    const context = getDialogContext();

    onMount(() => {
        const initialURI = getInitialData?.()?.webDAVactiveConnectionURI;
        if (!initialURI) return;
        try {
            Object.assign(connection, parseWebDAVConnectionURI(initialURI));
        } catch {
            // The form remains editable when an older or malformed value is supplied.
        }
    });

    let error = $state("");
    let processing = $state(false);

    function normalisedConnection(): WebDAVConnection {
        const journalFormat = connection.journalFormat ?? "opaque-v1";
        return {
            ...connection,
            endpoint: connection.endpoint.trim(),
            prefix: connection.prefix.trim(),
            username: connection.username.trim(),
            journalFormat,
            expectedRepositoryId:
                journalFormat === "adaptive-v1" ? (connection.expectedRepositoryId ?? "").trim() : "",
            packReadPolicy:
                journalFormat === "adaptive-v1" ? (connection.packReadPolicy ?? "whole-pack") : "whole-pack",
        };
    }

    function isConnectionValid(): boolean {
        try {
            serialiseWebDAVConnectionURI(normalisedConnection());
            return normalisedConnection().endpoint.length > 0;
        } catch {
            return false;
        }
    }

    const canProceed = $derived.by(isConnectionValid);
    const isAdaptive = $derived(connection.journalFormat === "adaptive-v1");
    const isEndpointInsecure = $derived.by(() => connection.endpoint.trim().toLowerCase().startsWith("http://"));
    const isEndpointInvalid = $derived.by(() => connection.endpoint.trim() !== "" && !canProceed);

    function generateSetting(): ObsidianLiveSyncSettings {
        return {
            ...DEFAULT_SETTINGS,
            ...PREFERRED_JOURNAL_SYNC,
            remoteType: REMOTE_WEBDAV,
            webDAVactiveConnectionURI: serialiseWebDAVConnectionURI(normalisedConnection()),
        };
    }

    async function checkConnection() {
        try {
            processing = true;
            const trialRemoteSetting = generateSetting();
            const replicator = await context.services.replicator.getNewReplicator(trialRemoteSetting);
            if (!replicator) return "Failed to create a Journal replicator.";
            try {
                return (await replicator.tryConnectRemote(trialRemoteSetting, false))
                    ? ""
                    : "Failed to connect to the WebDAV collection. Please check the endpoint, credentials, and prefix.";
            } catch (ex) {
                return `Failed to connect to the WebDAV collection: ${ex}`;
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
                setResult({ webDAVactiveConnectionURI: generateSetting().webDAVactiveConnectionURI });
            }
        } catch (ex) {
            error = `Error during connection test: ${ex}`;
        }
    }

    function commit() {
        setResult({ webDAVactiveConnectionURI: generateSetting().webDAVactiveConnectionURI });
    }
</script>

<DialogHeader title="WebDAV Journal Configuration" />
<Guidance>
    Configure a dedicated WebDAV collection for Journal synchronisation. The server must support MKCOL, PUT, GET,
    PROPFIND, and DELETE.
</Guidance>

<InputRow label="Endpoint URL">
    <input
        type="text"
        name="webdav-endpoint"
        placeholder="https://dav.example/remote.php/dav/files/alice"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        pattern="^https?://.+"
        bind:value={connection.endpoint}
    />
</InputRow>
<InfoNote warning visible={isEndpointInsecure}>Secure HTTPS connections are required on Obsidian Mobile.</InfoNote>
<InfoNote error visible={isEndpointInvalid}>
    Enter a complete HTTP or HTTPS endpoint without a query string or fragment.
</InfoNote>

<InputRow label="Username">
    <input
        type="text"
        name="webdav-username"
        placeholder="WebDAV username"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={connection.username}
    />
</InputRow>
<InputRow label="Password">
    <Password name="webdav-password" placeholder="WebDAV password" bind:value={connection.password} />
</InputRow>
<InputRow label="Collection Prefix">
    <input
        type="text"
        name="webdav-prefix"
        placeholder="livesync-journal/"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={connection.prefix}
    />
</InputRow>
<InfoNote>
    Use a dedicated prefix. WebDAV listing scans the collection, so unrelated files and a very long Journal history
    increase synchronisation work.
</InfoNote>

<InputRow label="Use internal API">
    <input type="checkbox" name="webdav-use-internal-api" bind:checked={connection.useCustomRequestHandler} />
</InputRow>
<InfoNote>
    Enable this when browser-compatible requests are blocked by CORS. It uses Obsidian's internal request API and may
    behave differently from standard browser fetch.
</InfoNote>

<ExtraItems title="Advanced Settings">
    <InputRow label="Journal Data Format">
        <select name="webdav-journal-format" bind:value={connection.journalFormat}>
            <option value="opaque-v1">Opaque Journal (current format)</option>
            <option value="adaptive-v1">Adaptive Journal (experimental)</option>
        </select>
    </InputRow>
    <InfoNote warning visible={isAdaptive}>
        Adaptive Journal uses a different remote data format. Existing Opaque data is not migrated or read; rebuild the
        remote when changing formats.
    </InfoNote>
    {#if isAdaptive}
        <InputRow label="Pack Retrieval">
            <select name="webdav-pack-read-policy" bind:value={connection.packReadPolicy}>
                <option value="whole-pack">Download complete packs</option>
                <option value="range">Use HTTP Range requests</option>
            </select>
        </InputRow>
        <InfoNote>
            Complete-pack reads favour throughput. Range reads can reduce transferred bytes, but require correct HTTP
            byte-range support; the connection test checks that capability when selected.
        </InfoNote>
    {/if}
    <InputRow label="Custom Headers">
        <textarea
            name="webdav-custom-headers"
            placeholder="e.g., x-example-header: value"
            bind:value={connection.customHeaders}
            autocapitalize="off"
            spellcheck="false"
            rows="4"
        ></textarea>
    </InputRow>
</ExtraItems>

<InfoNote>
    The saved connection contains credentials and custom headers. LiveSync encrypts it when configuration encryption is
    enabled; do not share an exported connection string as ordinary text.
</InfoNote>
<InfoNote error visible={error !== ""}>{error}</InfoNote>

{#if processing}
    Checking connection... Please wait.
{:else}
    <UserDecisions>
        <Decision title="Test Settings and Continue" important disabled={!canProceed} commit={() => checkAndCommit()} />
        <Decision title="Continue anyway" disabled={!canProceed} commit={() => commit()} />
        <Decision title="Cancel" commit={() => setResult(TYPE_CANCELLED)} />
    </UserDecisions>
{/if}
