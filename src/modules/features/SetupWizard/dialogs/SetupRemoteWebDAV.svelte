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
        REMOTE_WEBDAV,
        isJournalStorageConnectionInspector,
        type JournalStorageConnectivityResult,
        type WebDAVSyncSetting,
    } from "@vrtmrz/livesync-commonlib/journal-storage";
    import {
        TYPE_CANCELLED,
        type SetupRemoteWebDAVInitialData,
        type SetupRemoteWebDAVResultType,
        type WebDAVSetupMode,
    } from "./setupDialogTypes";
    import {
        summariseAdaptiveCapabilityInspection,
        webDAVJournalFormFromSettings,
        webDAVSyncSettingsFromForm,
        type WebDAVJournalForm,
    } from "./webDAVJournalSettings";
    import { $msg as translateMessage } from "@/common/translation";

    let syncSetting = $state<WebDAVJournalForm>(
        webDAVJournalFormFromSettings({
            webDAVactiveConnectionURI: "",
            expectedRepositoryId: "",
            journalFormat: "opaque-v1",
            packReadPolicy: "whole-pack",
        })
    );
    let setupMode = $state<WebDAVSetupMode>("settings");
    let error = $state("");
    let processing = $state(false);
    let inspection = $state<JournalStorageConnectivityResult | undefined>();
    let inspectionFingerprint = $state("");
    let inspectedSettings = $state<WebDAVSyncSetting | undefined>();

    type Props = GuestDialogProps<SetupRemoteWebDAVResultType, SetupRemoteWebDAVInitialData>;
    const { setResult, getInitialData }: Props = $props();
    const context = getDialogContext();

    onMount(() => {
        const initialData = getInitialData?.();
        if (!initialData) return;
        setupMode = initialData.mode;
        try {
            Object.assign(syncSetting, webDAVJournalFormFromSettings(initialData.settings));
        } catch (ex) {
            error = translateMessage("Invalid WebDAV settings: ${REASON}", {
                REASON: ex instanceof Error ? ex.message : `${ex}`,
            });
        }
    });

    const isAdaptive = $derived(syncSetting.journalFormat === "adaptive-v1");
    const isEndpointInsecure = $derived.by(() => syncSetting.endpoint.trim().toLowerCase().startsWith("http://"));
    const isEndpointValid = $derived.by(() => {
        try {
            const endpoint = new URL(syncSetting.endpoint.trim());
            return (
                (endpoint.protocol === "http:" || endpoint.protocol === "https:") &&
                endpoint.search === "" &&
                endpoint.hash === ""
            );
        } catch {
            return false;
        }
    });
    const isEndpointInvalid = $derived(syncSetting.endpoint.trim() !== "" && !isEndpointValid);
    const formFingerprint = $derived.by(() => JSON.stringify(syncSetting));
    const inspectionIsCurrent = $derived(
        inspection !== undefined && inspectionFingerprint !== "" && inspectionFingerprint === formFingerprint
    );
    const adaptiveSummary = $derived.by(() => {
        if (!inspectionIsCurrent || !inspection?.adaptiveCapabilities) return undefined;
        return summariseAdaptiveCapabilityInspection(inspection.adaptiveCapabilities);
    });

    function generateSetting(webDAVSettings: WebDAVSyncSetting): ObsidianLiveSyncSettings {
        return {
            ...DEFAULT_SETTINGS,
            ...PREFERRED_JOURNAL_SYNC,
            remoteType: REMOTE_WEBDAV,
            ...webDAVSettings,
        };
    }

    function explainUnavailable(result: JournalStorageConnectivityResult): string {
        if (
            result.remoteFormat !== undefined &&
            result.remoteFormat !== "empty" &&
            result.remoteFormat !== syncSetting.journalFormat
        ) {
            return translateMessage(
                "The remote contains ${REMOTE_FORMAT} data, but this profile selects ${SELECTED_FORMAT}. Rebuild the remote or restore the matching format.",
                {
                    REMOTE_FORMAT: result.remoteFormat,
                    SELECTED_FORMAT: syncSetting.journalFormat,
                }
            );
        }
        return translateMessage("The selected WebDAV Journal policy is not supported by this endpoint.");
    }

    async function inspectConnection(trialRemoteSetting: ObsidianLiveSyncSettings, testedFingerprint: string) {
        const replicator = await context.services.replicator.getNewReplicator(trialRemoteSetting);
        if (!replicator) {
            throw new Error(translateMessage("Failed to create replicator instance."));
        }
        if (!isJournalStorageConnectionInspector(replicator)) {
            throw new Error(translateMessage("This build cannot inspect WebDAV Journal capabilities."));
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
            const candidate = webDAVSyncSettingsFromForm(syncSetting);
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
        try {
            setResult(webDAVSyncSettingsFromForm(syncSetting));
        } catch (ex) {
            error = translateMessage("Invalid WebDAV settings: ${REASON}", {
                REASON: ex instanceof Error ? ex.message : `${ex}`,
            });
        }
    }
</script>

<DialogHeader title={translateMessage("WebDAV Journal Configuration")} />
<Guidance>
    {translateMessage(
        "Configure a dedicated WebDAV collection for Journal synchronisation. Opaque Journal needs ordinary WebDAV access. Adaptive Journal additionally runs an endpoint safety check before the profile is accepted."
    )}
</Guidance>

<InputRow label={translateMessage("Endpoint URL")}>
    <input
        type="text"
        name="webdav-endpoint"
        placeholder="https://dav.example/remote.php/dav/files/alice"
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
<InfoNote error visible={isEndpointInvalid}>
    {translateMessage("Enter a complete HTTP or HTTPS endpoint without a query string or fragment.")}
</InfoNote>

<InputRow label={translateMessage("Username")}>
    <input
        type="text"
        name="webdav-username"
        placeholder={translateMessage("Enter your username")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.username}
    />
</InputRow>
<InputRow label={translateMessage("Password")}>
    <Password
        name="webdav-password"
        placeholder={translateMessage("Enter your password")}
        bind:value={syncSetting.password}
    />
</InputRow>
<InputRow label={translateMessage("Collection prefix")}>
    <input
        type="text"
        name="webdav-prefix"
        placeholder="livesync-journal/"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.prefix}
    />
</InputRow>
<InfoNote>
    {translateMessage(
        "Use a dedicated prefix. WebDAV listing scans the collection, so unrelated files and a long Journal history increase discovery work."
    )}
</InfoNote>

<InputRow label={translateMessage("Use internal API")}>
    <input type="checkbox" name="webdav-use-internal-api" bind:checked={syncSetting.useCustomRequestHandler} />
</InputRow>
<InfoNote>
    {translateMessage(
        "Enable this when browser-compatible requests are blocked by CORS. It uses Obsidian's internal request API and may behave differently from standard browser fetch."
    )}
</InfoNote>

<ExtraItems title={translateMessage("Advanced Settings")}>
    <InputRow label={translateMessage("Journal data format")}>
        <select name="webdav-journal-format" bind:value={syncSetting.journalFormat}>
            <option value="opaque-v1">{translateMessage("Opaque Journal (current format)")}</option>
            <option value="adaptive-v1">{translateMessage("Adaptive Journal (experimental)")}</option>
        </select>
    </InputRow>
    <InfoNote warning visible={isAdaptive}>
        {translateMessage(
            "Adaptive Journal uses immutable objects and a separate remote format. Existing Opaque Journal data is not migrated or read. Rebuild the remote when changing formats."
        )}
    </InfoNote>
    {#if isAdaptive}
        <InputRow label={translateMessage("Expected repository ID")}>
            <input
                type="text"
                name="webdav-expected-repository-id"
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
        <InputRow label={translateMessage("Pack retrieval")}>
            <select name="webdav-pack-read-policy" bind:value={syncSetting.packReadPolicy}>
                <option value="whole-pack">{translateMessage("Download complete Packs")}</option>
                <option value="range">{translateMessage("Use HTTP Range requests")}</option>
            </select>
        </InputRow>
        <InfoNote>
            {translateMessage(
                "Complete Pack reads favour throughput and are the portable default. Range reads can reduce transferred bytes, but this endpoint must pass the exact byte-range check."
            )}
        </InfoNote>
        <InfoNote caution>
            {translateMessage(
                "The Adaptive safety check writes, reads, lists, and removes disposable objects under a random probe prefix. It does not inspect Vault data."
            )}
        </InfoNote>
    {/if}
    <InputRow label={translateMessage("Custom Headers")}>
        <textarea
            name="webdav-custom-headers"
            placeholder="e.g., x-example-header: value"
            bind:value={syncSetting.customHeaders}
            autocapitalize="off"
            spellcheck="false"
            rows="4"
        ></textarea>
    </InputRow>
</ExtraItems>

{#if adaptiveSummary}
    {#if adaptiveSummary.required.kind === "verified"}
        <InfoNote notice>
            {translateMessage("Required Adaptive operations are supported by this WebDAV endpoint.")}
        </InfoNote>
    {:else if adaptiveSummary.required.kind === "unsupported"}
        <InfoNote error>
            {translateMessage("The WebDAV endpoint is missing required Adaptive operations: ${CAPABILITIES}.", {
                CAPABILITIES: adaptiveSummary.required.missing.join(", "),
            })}
        </InfoNote>
    {:else if adaptiveSummary.required.kind === "failed"}
        <InfoNote error>
            {translateMessage("The Adaptive safety check failed (${CATEGORY}; retry ${RETRY}).", {
                CATEGORY: adaptiveSummary.required.category,
                RETRY: adaptiveSummary.required.retry,
            })}
        </InfoNote>
    {:else}
        <InfoNote warning>{translateMessage("Required Adaptive operations were not checked.")}</InfoNote>
    {/if}

    {#if adaptiveSummary.byteRange.kind === "verified"}
        <InfoNote notice>{translateMessage("Exact HTTP byte-range retrieval is supported.")}</InfoNote>
    {:else if adaptiveSummary.byteRange.kind === "unsupported"}
        <InfoNote warning>
            {translateMessage("HTTP byte-range retrieval is not supported. Complete Pack retrieval remains available.")}
        </InfoNote>
    {:else if adaptiveSummary.byteRange.kind === "failed"}
        <InfoNote warning>
            {translateMessage("The Adaptive safety check failed (${CATEGORY}; retry ${RETRY}).", {
                CATEGORY: adaptiveSummary.byteRange.category,
                RETRY: adaptiveSummary.byteRange.retry,
            })}
        </InfoNote>
    {:else}
        <InfoNote warning>
            {translateMessage(
                "HTTP byte-range retrieval was not checked because the required safety check did not complete."
            )}
        </InfoNote>
    {/if}
{/if}
{#if inspectionIsCurrent && inspection?.available && !isAdaptive}
    <InfoNote notice>
        {translateMessage("WebDAV access and the selected Journal format were verified.")}
    </InfoNote>
{/if}

<InfoNote>
    {translateMessage(
        "The saved connection contains credentials and custom headers. Configuration encryption protects exported Setup data when it is enabled; do not share a plain connection string."
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
                title={isAdaptive
                    ? translateMessage("Run endpoint safety check")
                    : translateMessage("Test WebDAV connection")}
                disabled={!isEndpointValid}
                commit={() => checkConnection()}
            />
        {:else}
            <Decision
                title={isAdaptive
                    ? translateMessage("Run endpoint safety check")
                    : translateMessage("Test WebDAV connection")}
                important
                disabled={!isEndpointValid}
                commit={() => checkConnection()}
            />
        {/if}
        {#if setupMode === "settings"}
            <InfoNote warning>
                {translateMessage(
                    "Saving without a successful connection test keeps this profile, but automatic synchronisation may fail until the connection is corrected."
                )}
            </InfoNote>
            <Decision
                title={translateMessage("Save without connecting")}
                disabled={!isEndpointValid}
                commit={() => commit()}
            />
        {/if}
        <Decision title={translateMessage("Cancel")} commit={() => setResult(TYPE_CANCELLED)} />
    </UserDecisions>
{/if}
