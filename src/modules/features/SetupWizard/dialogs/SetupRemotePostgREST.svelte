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
    import {
        DEFAULT_SETTINGS,
        PREFERRED_JOURNAL_SYNC,
        type ObsidianLiveSyncSettings,
    } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import {
        REMOTE_POSTGREST,
        isJournalStorageConnectionInspector,
        type JournalStorageConnectivityResult,
        type PostgRESTSyncSetting,
    } from "@vrtmrz/livesync-commonlib/journal-storage";
    import {
        TYPE_CANCELLED,
        type PostgRESTSetupMode,
        type SetupRemotePostgRESTInitialData,
        type SetupRemotePostgRESTResultType,
    } from "./setupDialogTypes";
    import {
        postgRESTJournalFormFromSettings,
        postgRESTSyncSettingsFromForm,
        type PostgRESTJournalForm,
    } from "./postgRESTJournalSettings";
    import { $msg as translateMessage } from "@/common/translation";

    let syncSetting = $state<PostgRESTJournalForm>(
        postgRESTJournalFormFromSettings({
            postgrestActiveConnectionURI: "",
            expectedRepositoryId: "",
            journalFormat: "adaptive-v1",
            packReadPolicy: "whole-pack",
        })
    );
    let setupMode = $state<PostgRESTSetupMode>("settings");
    let error = $state("");
    let processing = $state(false);
    let inspection = $state<JournalStorageConnectivityResult | undefined>();
    let inspectionFingerprint = $state("");
    let inspectedSettings = $state<PostgRESTSyncSetting | undefined>();

    type Props = GuestDialogProps<SetupRemotePostgRESTResultType, SetupRemotePostgRESTInitialData>;
    const { setResult, getInitialData }: Props = $props();
    const context = getDialogContext();

    onMount(() => {
        const initialData = getInitialData?.();
        if (!initialData) return;
        setupMode = initialData.mode;
        try {
            Object.assign(syncSetting, postgRESTJournalFormFromSettings(initialData.settings));
        } catch (ex) {
            error = translateMessage("Invalid PostgREST settings: ${REASON}", {
                REASON: ex instanceof Error ? ex.message : `${ex}`,
            });
        }
    });

    const isEndpointInsecure = $derived.by(() => syncSetting.endpoint.trim().toLowerCase().startsWith("http://"));
    const isEndpointValid = $derived.by(() => {
        try {
            const endpoint = new URL(syncSetting.endpoint.trim());
            return (
                (endpoint.protocol === "http:" || endpoint.protocol === "https:") &&
                endpoint.username === "" &&
                endpoint.password === "" &&
                endpoint.search === "" &&
                endpoint.hash === ""
            );
        } catch {
            return false;
        }
    });
    const isSchemaValid = $derived(/^[A-Za-z_][A-Za-z0-9_]*$/u.test(syncSetting.schema.trim()));
    const isVaultIdValid = $derived(/^[A-Za-z0-9_-]{16,128}$/u.test(syncSetting.vaultId.trim()));
    const isVaultCredentialValid = $derived(
        syncSetting.vaultCredential.length > 0 && new TextEncoder().encode(syncSetting.vaultCredential).byteLength <= 512
    );
    const isConnectionValid = $derived(
        isEndpointValid && isSchemaValid && isVaultIdValid && isVaultCredentialValid
    );
    const hasInvalidInput = $derived.by(
        () =>
            (syncSetting.endpoint.trim() !== "" ||
                syncSetting.vaultId.trim() !== "" ||
                syncSetting.vaultCredential !== "") &&
            !isConnectionValid
    );
    const formFingerprint = $derived.by(() => JSON.stringify(syncSetting));
    const inspectionIsCurrent = $derived(
        inspection !== undefined && inspectionFingerprint !== "" && inspectionFingerprint === formFingerprint
    );
    const requiredCapability = $derived.by(() => {
        if (!inspectionIsCurrent) return undefined;
        return inspection?.adaptiveCapabilities?.required;
    });

    function generateSetting(postgRESTSettings: PostgRESTSyncSetting): ObsidianLiveSyncSettings {
        return {
            ...DEFAULT_SETTINGS,
            ...PREFERRED_JOURNAL_SYNC,
            remoteType: REMOTE_POSTGREST,
            ...postgRESTSettings,
        };
    }

    function explainUnavailable(result: JournalStorageConnectivityResult): string {
        if (result.remoteFormat !== undefined && result.remoteFormat !== "empty" && result.remoteFormat !== "adaptive-v1") {
            return translateMessage(
                "The remote contains ${REMOTE_FORMAT} data, but this profile selects ${SELECTED_FORMAT}. Rebuild the remote or restore the matching format.",
                { REMOTE_FORMAT: result.remoteFormat, SELECTED_FORMAT: "adaptive-v1" }
            );
        }
        const required = result.adaptiveCapabilities?.required;
        if (required?.status === "unsupported") {
            return translateMessage("The PostgREST SQL contract is missing required operations: ${CAPABILITIES}.", {
                CAPABILITIES: required.missing.join(", "),
            });
        }
        if (required?.status === "failed") {
            return translateMessage("The Adaptive safety check failed (${CATEGORY}; retry ${RETRY}).", {
                CATEGORY: required.failure.category,
                RETRY: required.failure.retry,
            });
        }
        return translateMessage("The PostgREST SQL contract is unavailable or incompatible with this build.");
    }

    async function inspectConnection(trialRemoteSetting: ObsidianLiveSyncSettings, testedFingerprint: string) {
        const replicator = await context.services.replicator.getNewReplicator(trialRemoteSetting);
        if (!replicator) {
            throw new Error(translateMessage("Failed to create replicator instance."));
        }
        if (!isJournalStorageConnectionInspector(replicator)) {
            throw new Error(translateMessage("This build cannot inspect PostgREST Journal capabilities."));
        }
        const result = await replicator.inspectJournalStorageConnection(trialRemoteSetting);
        inspection = result;
        inspectionFingerprint = testedFingerprint;
        return result;
    }

    async function checkConnection() {
        error = "";
        inspection = undefined;
        inspectionFingerprint = "";
        inspectedSettings = undefined;
        processing = true;
        try {
            const testedFingerprint = formFingerprint;
            const candidate = postgRESTSyncSettingsFromForm(syncSetting);
            const trialRemoteSetting = generateSetting(candidate);
            const result = await inspectConnection(trialRemoteSetting, testedFingerprint);
            if (testedFingerprint !== formFingerprint) return;
            if (!result.available) {
                error = explainUnavailable(result);
                return;
            }
            inspectedSettings = candidate;
        } catch (ex) {
            error = translateMessage("Error during connection test: ${reason}", {
                reason: ex instanceof Error ? ex.message : `${ex}`,
            });
        } finally {
            processing = false;
        }
    }

    function commitVerified() {
        if (!inspectionIsCurrent || !inspection?.available || !inspectedSettings) return;
        setResult(inspectedSettings);
    }

    function commit() {
        error = "";
        if (!isConnectionValid) return;
        try {
            setResult(postgRESTSyncSettingsFromForm(syncSetting));
        } catch (ex) {
            error = translateMessage("Invalid PostgREST settings: ${REASON}", {
                REASON: ex instanceof Error ? ex.message : `${ex}`,
            });
        }
    }
</script>

<DialogHeader title={translateMessage("PostgREST Journal Configuration")} />
<Guidance>
    {translateMessage(
        "Connect to the packaged, Adaptive-only PostgREST RPC contract. This experimental provider is not a CouchDB endpoint and does not expose synchronisation tables directly."
    )}
</Guidance>

<InputRow label={translateMessage("Endpoint URL")}>
    <input
        type="text"
        name="postgrest-endpoint"
        placeholder="https://project.example/rest/v1"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        pattern="^https?://.+"
        bind:value={syncSetting.endpoint}
    />
</InputRow>
<InfoNote warning visible={isEndpointInsecure}>
    {translateMessage("We can use only Secure (HTTPS) connections on Obsidian Mobile.")}
</InfoNote>
<InfoNote error visible={syncSetting.endpoint.trim() !== "" && !isEndpointValid}>
    {translateMessage(
        "Enter a complete HTTP or HTTPS PostgREST endpoint without database credentials, a query string, or a fragment."
    )}
</InfoNote>

<InputRow label={translateMessage("Vault ID")}>
    <input
        type="text"
        name="postgrest-vault-id"
        placeholder="provisioned-vault-id"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.vaultId}
    />
</InputRow>
<InputRow label={translateMessage("Vault credential")}>
    <Password
        name="postgrest-vault-credential"
        placeholder={translateMessage("Enter the provisioned Vault credential")}
        required
        bind:value={syncSetting.vaultCredential}
    />
</InputRow>
<InfoNote>
    {translateMessage(
        "A trusted database administrator obtains both values once from livesync_private.provision_adaptive_vault(). PostgreSQL retains only a verifier for the credential."
    )}
</InfoNote>

<InputRow label={translateMessage("Exposed schema")}>
    <input
        type="text"
        name="postgrest-schema"
        placeholder="livesync_api"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.schema}
    />
</InputRow>
<InputRow label={translateMessage("Client API key (optional)")}>
    <Password
        name="postgrest-api-key"
        placeholder={translateMessage("Supabase publishable key, if required")}
        bind:value={syncSetting.apiKey}
    />
</InputRow>
<InfoNote caution>
    {translateMessage(
        "Use only a publishable or equivalent client-safe API key. Never enter a Supabase secret key, service_role JWT, or database credential."
    )}
</InfoNote>
<InfoNote error visible={hasInvalidInput}>
    {translateMessage(
        "Supply a valid endpoint, PostgreSQL schema identifier, provisioned Vault ID, and Vault credential."
    )}
</InfoNote>

<InputRow label={translateMessage("Use internal API")}>
    <input type="checkbox" name="postgrest-use-internal-api" bind:checked={syncSetting.useCustomRequestHandler} />
</InputRow>
<InfoNote>
    {translateMessage(
        "Enable this when browser-compatible requests are blocked by CORS. It uses Obsidian's internal request API and may behave differently from standard browser fetch."
    )}
</InfoNote>

<ExtraItems title={translateMessage("Advanced Settings")}>
    <InputRow label={translateMessage("Expected repository ID")}>
        <input
            type="text"
            name="postgrest-expected-repository-id"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            bind:value={syncSetting.expectedRepositoryId}
        />
    </InputRow>
    <InfoNote>
        {translateMessage(
            "This optional identity pins a trusted Adaptive repository. A Setup URI can supply it; leave it blank only when creating a repository or intentionally trusting the first compatible repository reached."
        )}
    </InfoNote>
</ExtraItems>

<InfoNote warning>
    {translateMessage(
        "PostgREST stores only Adaptive Journal records. It cannot read Opaque Journal data, and format changes require a remote Rebuild rather than an in-place migration."
    )}
</InfoNote>
{#if requiredCapability?.status === "verified"}
    <InfoNote notice>
        {translateMessage("The required PostgREST RPC operations and binary semantics were verified.")}
    </InfoNote>
{:else if requiredCapability?.status === "unsupported"}
    <InfoNote error>
        {translateMessage("The PostgREST SQL contract is missing required operations: ${CAPABILITIES}.", {
            CAPABILITIES: requiredCapability.missing.join(", "),
        })}
    </InfoNote>
{:else if requiredCapability?.status === "failed"}
    <InfoNote error>
        {translateMessage("The Adaptive safety check failed (${CATEGORY}; retry ${RETRY}).", {
            CATEGORY: requiredCapability.failure.category,
            RETRY: requiredCapability.failure.retry,
        })}
    </InfoNote>
{:else if inspectionIsCurrent}
    <InfoNote warning>{translateMessage("Required Adaptive operations were not checked.")}</InfoNote>
{/if}

<InfoNote>
    {translateMessage(
        "The saved connection contains the Vault credential and optional API key. Configuration encryption protects exported Setup data when it is enabled; do not share a plain connection string."
    )}
</InfoNote>
<InfoNote error visible={error !== ""}>{error}</InfoNote>

{#if processing}
    {translateMessage("Checking connection... Please wait.")}
{:else}
    <UserDecisions>
        {#if inspectionIsCurrent && inspection?.available && inspectedSettings}
            <Decision
                title={setupMode === "settings"
                    ? translateMessage("Save verified settings")
                    : translateMessage("Continue with verified settings")}
                important
                commit={() => commitVerified()}
            />
            <Decision
                title={translateMessage("Check PostgREST server")}
                disabled={!isConnectionValid}
                commit={() => checkConnection()}
            />
        {:else}
            <Decision
                title={translateMessage("Check PostgREST server")}
                important
                disabled={!isConnectionValid}
                commit={() => checkConnection()}
            />
        {/if}
        {#if setupMode === "settings"}
            <InfoNote warning>
                {translateMessage(
                    "Saving without a successful connection test keeps this profile, but automatic synchronisation may fail until the connection or server SQL is corrected."
                )}
            </InfoNote>
            <Decision
                title={translateMessage("Save without connecting")}
                disabled={!isConnectionValid}
                commit={() => commit()}
            />
        {/if}
        <Decision title={translateMessage("Cancel")} commit={() => setResult(TYPE_CANCELLED)} />
    </UserDecisions>
{/if}
