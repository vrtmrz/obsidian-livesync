<script lang="ts">
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import Guidance from "@/modules/services/LiveSyncUI/components/Guidance.svelte";
    import Decision from "@/modules/services/LiveSyncUI/components/Decision.svelte";
    import UserDecisions from "@/modules/services/LiveSyncUI/components/UserDecisions.svelte";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import ExtraItems from "@/modules/services/LiveSyncUI/components/ExtraItems.svelte";
    import InputRow from "@/modules/services/LiveSyncUI/components/InputRow.svelte";
    import Password from "@/modules/services/LiveSyncUI/components/Password.svelte";
    import {
        type BucketSyncSetting,
        type ObsidianLiveSyncSettings,
        DEFAULT_SETTINGS,
        PREFERRED_JOURNAL_SYNC,
        RemoteTypes,
    } from "@vrtmrz/livesync-commonlib/compat/common/types";

    import { onMount } from "svelte";
    import { getDialogContext, type GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import { copyTo, pickBucketSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/utils";
    import { TYPE_CANCELLED, type SetupRemoteBucketResultType } from "./setupDialogTypes";
    import { $msg as translateMessage } from "@/common/translation";

    const default_setting = pickBucketSyncSettings(DEFAULT_SETTINGS);

    let syncSetting = $state<BucketSyncSetting>({ ...default_setting });

    type Props = GuestDialogProps<SetupRemoteBucketResultType, BucketSyncSetting>;

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
    const context = getDialogContext();
    const isEndpointSecure = $derived.by(() => {
        return syncSetting.endpoint.trim().toLowerCase().startsWith("https://");
    });
    const isEndpointInsecure = $derived.by(() => {
        return syncSetting.endpoint.trim().toLowerCase().startsWith("http://");
    });
    const isEndpointSupplied = $derived.by(() => {
        return isEndpointInsecure || isEndpointSecure;
    });
    const canProceed = $derived.by(() => {
        return (
            syncSetting.accessKey.trim() !== "" &&
            syncSetting.secretKey.trim() !== "" &&
            syncSetting.bucket.trim() !== "" &&
            syncSetting.endpoint.trim() !== "" &&
            syncSetting.region.trim() !== "" &&
            isEndpointSupplied
        );
    });

    function generateSetting() {
        const connSetting: BucketSyncSetting = {
            ...syncSetting,
        };
        const trialSettings: BucketSyncSetting = {
            ...connSetting,
        };

        const trialRemoteSetting: ObsidianLiveSyncSettings = {
            ...DEFAULT_SETTINGS,
            ...PREFERRED_JOURNAL_SYNC,
            remoteType: RemoteTypes.REMOTE_MINIO,
            ...trialSettings,
        };
        return trialRemoteSetting;
    }

    let processing = $state(false);
    async function checkConnection() {
        try {
            processing = true;
            const trialRemoteSetting = generateSetting();
            const replicator = await context.services.replicator.getNewReplicator(trialRemoteSetting);
            if (!replicator) {
                return translateMessage("Failed to create replicator instance.");
            }
            try {
                const result = await replicator.tryConnectRemote(trialRemoteSetting, false);
                if (result) {
                    return "";
                } else {
                    return translateMessage("Failed to connect to the server. Please check your settings.");
                }
            } catch (e) {
                return translateMessage("Failed to connect to the server: ${reason}", { reason: `${e}` });
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
                const setting = generateSetting();
                setResult(pickBucketSyncSettings(setting));
                return;
            }
        } catch (e) {
            error = translateMessage("Error during connection test: ${reason}", { reason: `${e}` });
            return;
        }
    }
    function commit() {
        const setting = pickBucketSyncSettings(generateSetting());
        setResult(setting);
    }
    function cancel() {
        setResult(TYPE_CANCELLED);
    }
</script>

<DialogHeader title={translateMessage("S3/MinIO/R2 Configuration")} />
<Guidance
    >{translateMessage(
        "Please enter the details required to connect to your S3/MinIO/R2 compatible object storage service."
    )}</Guidance
>
<InputRow label={translateMessage("Endpoint URL")}>
    <input
        type="text"
        name="s3-endpoint"
        placeholder="https://s3.amazonaws.com"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        pattern="^https?://.+"
        bind:value={syncSetting.endpoint}
    />
</InputRow>
<InfoNote warning visible={isEndpointInsecure}
    >{translateMessage("We can use only Secure (HTTPS) connections on Obsidian Mobile.")}</InfoNote
>

<InputRow label={translateMessage("Access Key ID")}>
    <input
        type="text"
        name="s3-access-key-id"
        placeholder={translateMessage("Enter your Access Key ID")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.accessKey}
    />
</InputRow>

<InputRow label={translateMessage("Secret Access Key")}>
    <Password
        name="s3-secret-access-key"
        placeholder={translateMessage("Enter your Secret Access Key")}
        required
        bind:value={syncSetting.secretKey}
    />
</InputRow>
<InputRow label={translateMessage("Bucket Name")}>
    <input
        type="text"
        name="s3-bucket-name"
        placeholder={translateMessage("Enter your Bucket Name")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.bucket}
    /></InputRow
>
<InputRow label={translateMessage("Region")}>
    <input
        type="text"
        name="s3-region"
        placeholder={translateMessage("Enter your Region (e.g., us-east-1, auto for R2)")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.region}
    />
</InputRow>
<InputRow label={translateMessage("Use Path-Style Access")}>
    <input type="checkbox" name="s3-use-path-style" bind:checked={syncSetting.forcePathStyle} />
</InputRow>

<InputRow label={translateMessage("Folder Prefix")}>
    <input
        type="text"
        name="s3-folder-prefix"
        placeholder={translateMessage("Enter a folder prefix (optional)")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.bucketPrefix}
    />
</InputRow>
<InfoNote>
    {translateMessage(
        "If you want to store the data in a specific folder within the bucket, you can specify a folder prefix here. Otherwise, leave it blank to store data at the root of the bucket."
    )}
</InfoNote>
<InputRow label={translateMessage("Use internal API")}>
    <input type="checkbox" name="s3-use-internal-api" bind:checked={syncSetting.useCustomRequestHandler} />
</InputRow>
<InfoNote>
    {translateMessage(
        "If you cannot avoid CORS issues, you might want to try this option. It uses Obsidian's internal API to communicate with the S3 server. Not compliant with web standards, but works. Note that this might break in future Obsidian versions."
    )}
</InfoNote>

<ExtraItems title={translateMessage("Advanced Settings")}>
    <InputRow label={translateMessage("Custom Headers")}>
        <textarea
            name="bucket-custom-headers"
            placeholder="e.g., x-example-header: value\n another-header: value2"
            bind:value={syncSetting.bucketCustomHeaders}
            autocapitalize="off"
            spellcheck="false"
            rows="4"
        ></textarea>
    </InputRow>
</ExtraItems>

<InfoNote error visible={error !== ""}>
    {error}
</InfoNote>

{#if processing}
    {translateMessage("Checking connection... Please wait.")}
{:else}
    <UserDecisions>
        <Decision
            title={translateMessage("Test Settings and Continue")}
            important
            disabled={!canProceed}
            commit={() => checkAndCommit()}
        />
        <Decision title={translateMessage("Continue anyway")} commit={() => commit()} />
        <Decision title={translateMessage("Cancel")} commit={() => cancel()} />
    </UserDecisions>
{/if}
