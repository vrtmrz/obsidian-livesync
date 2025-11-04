<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import Guidance from "@/lib/src/UI/components/Guidance.svelte";
    import Decision from "@/lib/src/UI/components/Decision.svelte";
    import UserDecisions from "@/lib/src/UI/components/UserDecisions.svelte";
    import InfoNote from "@/lib/src/UI/components/InfoNote.svelte";
    import ExtraItems from "@/lib/src/UI/components/ExtraItems.svelte";
    import InputRow from "@/lib/src/UI/components/InputRow.svelte";
    import Password from "@/lib/src/UI/components/Password.svelte";
    import {
        type BucketSyncSetting,
        type ObsidianLiveSyncSettings,
        DEFAULT_SETTINGS,
        PREFERRED_JOURNAL_SYNC,
        RemoteTypes,
    } from "../../../../lib/src/common/types";

    import { onMount } from "svelte";
    import type { GuestDialogProps } from "../../../../lib/src/UI/svelteDialog";
    import { getObsidianDialogContext } from "../ObsidianSvelteDialog";
    import { copyTo, pickBucketSyncSettings } from "../../../../lib/src/common/utils";

    const default_setting = pickBucketSyncSettings(DEFAULT_SETTINGS);

    let syncSetting = $state<BucketSyncSetting>({ ...default_setting });

    type ResultType = typeof TYPE_CANCELLED | BucketSyncSetting;
    type Props = GuestDialogProps<ResultType, BucketSyncSetting>;
    const TYPE_CANCELLED = "cancelled";

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
    const context = getObsidianDialogContext();
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
                return "Failed to create replicator instance.";
            }
            try {
                const result = await replicator.tryConnectRemote(trialRemoteSetting, false);
                if (result) {
                    return "";
                } else {
                    return "Failed to connect to the server. Please check your settings.";
                }
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
                const setting = generateSetting();
                setResult(pickBucketSyncSettings(setting));
                return;
            }
        } catch (e) {
            error = `Error during connection test: ${e}`;
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

<DialogHeader title="S3/MinIO/R2 Configuration" />
<Guidance>Please enter the details required to connect to your S3/MinIO/R2 compatible object storage service.</Guidance>
<InputRow label="Endpoint URL">
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
<InfoNote warning visible={isEndpointInsecure}>We can use only Secure (HTTPS) connections on Obsidian Mobile.</InfoNote>

<InputRow label="Access Key ID">
    <input
        type="text"
        name="s3-access-key-id"
        placeholder="Enter your Access Key ID"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.accessKey}
    />
</InputRow>

<InputRow label="Secret Access Key">
    <Password
        name="s3-secret-access-key"
        placeholder="Enter your Secret Access Key"
        required
        bind:value={syncSetting.secretKey}
    />
</InputRow>
<InputRow label="Bucket Name">
    <input
        type="text"
        name="s3-bucket-name"
        placeholder="Enter your Bucket Name"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.bucket}
    /></InputRow
>
<InputRow label="Region">
    <input
        type="text"
        name="s3-region"
        placeholder="Enter your Region (e.g., us-east-1, auto for R2)"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.region}
    />
</InputRow>
<InputRow label="Use Path-Style Access">
    <input type="checkbox" name="s3-use-path-style" bind:checked={syncSetting.forcePathStyle} />
</InputRow>

<InputRow label="Folder Prefix">
    <input
        type="text"
        name="s3-folder-prefix"
        placeholder="Enter a folder prefix (optional)"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.bucketPrefix}
    />
</InputRow>
<InfoNote>
    If you want to store the data in a specific folder within the bucket, you can specify a folder prefix here.
    Otherwise, leave it blank to store data at the root of the bucket.
</InfoNote>
<InputRow label="Use internal API">
    <input type="checkbox" name="s3-use-internal-api" bind:checked={syncSetting.useCustomRequestHandler} />
</InputRow>
<InfoNote>
    If you cannot avoid CORS issues, you might want to try this option. It uses Obsidian's internal API to communicate
    with the S3 server. Not compliant with web standards, but works. Note that this might break in future Obsidian
    versions.
</InfoNote>

<ExtraItems title="Advanced Settings">
    <InputRow label="Custom Headers">
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
    Checking connection... Please wait.
{:else}
    <UserDecisions>
        <Decision title="Test Settings and Continue" important disabled={!canProceed} commit={() => checkAndCommit()} />
        <Decision title="Continue anyway" commit={() => commit()} />
        <Decision title="Cancel" commit={() => cancel()} />
    </UserDecisions>
{/if}
