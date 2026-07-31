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
        REMOTE_POSTGREST,
        parsePostgRESTConnectionURI,
        serialisePostgRESTConnectionURI,
        type PostgRESTConnection,
        type PostgRESTSyncSetting,
    } from "@vrtmrz/livesync-commonlib/journal-storage";
    import { TYPE_CANCELLED, type SetupRemotePostgRESTResultType } from "./setupDialogTypes";

    const connection = $state<PostgRESTConnection>({
        endpoint: "",
        bearerToken: "",
        vaultId: "",
        schema: "livesync_api",
        useCustomRequestHandler: false,
        customHeaders: "",
    });

    type Props = GuestDialogProps<SetupRemotePostgRESTResultType, PostgRESTSyncSetting>;
    const { setResult, getInitialData }: Props = $props();
    const context = getDialogContext();

    onMount(() => {
        const initialURI = getInitialData?.()?.postgrestActiveConnectionURI;
        if (!initialURI) return;
        try {
            Object.assign(connection, parsePostgRESTConnectionURI(initialURI));
        } catch {
            // The form remains editable when an older or malformed value is supplied.
        }
    });

    let error = $state("");
    let processing = $state(false);

    function normalisedConnection(): PostgRESTConnection {
        return {
            ...connection,
            endpoint: connection.endpoint.trim(),
            bearerToken: connection.bearerToken.trim(),
            vaultId: connection.vaultId.trim(),
            schema: connection.schema.trim(),
        };
    }

    function isConnectionValid(): boolean {
        const value = normalisedConnection();
        if (!value.endpoint || !value.bearerToken || !value.vaultId || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.schema)) {
            return false;
        }
        try {
            serialisePostgRESTConnectionURI(value);
            return true;
        } catch {
            return false;
        }
    }

    const canProceed = $derived.by(isConnectionValid);
    const isEndpointInsecure = $derived.by(() => connection.endpoint.trim().toLowerCase().startsWith("http://"));
    const hasInvalidInput = $derived.by(
        () =>
            (connection.endpoint.trim() !== "" ||
                connection.bearerToken.trim() !== "" ||
                connection.vaultId.trim() !== "") &&
            !canProceed
    );

    function generateSetting(): ObsidianLiveSyncSettings {
        return {
            ...DEFAULT_SETTINGS,
            ...PREFERRED_JOURNAL_SYNC,
            remoteType: REMOTE_POSTGREST,
            postgrestActiveConnectionURI: serialisePostgRESTConnectionURI(normalisedConnection()),
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
                    : "Failed to connect to PostgREST. Please check the endpoint, token, Vault ID, schema, and server SQL.";
            } catch (ex) {
                return `Failed to connect to PostgREST: ${ex}`;
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
                setResult({ postgrestActiveConnectionURI: generateSetting().postgrestActiveConnectionURI });
            }
        } catch (ex) {
            error = `Error during connection test: ${ex}`;
        }
    }

    function commit() {
        setResult({ postgrestActiveConnectionURI: generateSetting().postgrestActiveConnectionURI });
    }
</script>

<DialogHeader title="PostgREST Journal Configuration" />
<Guidance>
    Configure the LiveSync Journal RPC schema exposed by PostgREST. This is a Journal object transport, not a CouchDB
    replacement or direct table editor.
</Guidance>

<InputRow label="PostgREST Endpoint URL">
    <input
        type="text"
        name="postgrest-endpoint"
        placeholder="https://journal.example"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        pattern="^https?://.+"
        bind:value={connection.endpoint}
    />
</InputRow>
<InfoNote warning visible={isEndpointInsecure}>Secure HTTPS connections are required on Obsidian Mobile.</InfoNote>

<InputRow label="Bearer Token">
    <Password
        name="postgrest-bearer-token"
        placeholder="Vault-scoped JWT"
        required
        bind:value={connection.bearerToken}
    />
</InputRow>
<InputRow label="Vault ID">
    <input
        type="text"
        name="postgrest-vault-id"
        placeholder="stable-vault-id"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={connection.vaultId}
    />
</InputRow>
<InfoNote>
    The Vault ID must exactly match the signed `vault_id` claim in the token. Keep it stable when rotating a token so
    that the Journal checkpoint and PostgreSQL row ownership remain unchanged.
</InfoNote>

<InputRow label="API Schema">
    <input
        type="text"
        name="postgrest-schema"
        placeholder="livesync_api"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={connection.schema}
    />
</InputRow>
<InfoNote error visible={hasInvalidInput}>
    Supply an HTTP(S) endpoint without a query or fragment, a bearer token, a Vault ID, and a PostgreSQL identifier for
    the schema.
</InfoNote>

<InputRow label="Use internal API">
    <input type="checkbox" name="postgrest-use-internal-api" bind:checked={connection.useCustomRequestHandler} />
</InputRow>
<InfoNote>
    Enable this when browser-compatible requests are blocked by CORS. It uses Obsidian's internal request API and may
    behave differently from standard browser fetch.
</InfoNote>

<ExtraItems title="Advanced Settings">
    <InputRow label="Custom Headers">
        <textarea
            name="postgrest-custom-headers"
            placeholder="e.g., x-example-header: value"
            bind:value={connection.customHeaders}
            autocapitalize="off"
            spellcheck="false"
            rows="4"
        ></textarea>
    </InputRow>
</ExtraItems>

<InfoNote>
    The server must have the packaged LiveSync PostgREST SQL installed. The saved connection contains a bearer token
    and custom headers; protect exported connection strings as credentials.
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
