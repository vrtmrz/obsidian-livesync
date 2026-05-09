<script lang="ts">
    import DialogHeader from "@/lib/src/UI/components/DialogHeader.svelte";
    import { $msg as msg } from "@/lib/src/common/i18n";
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
    import { getDialogContext, type GuestDialogProps } from "../../../../lib/src/UI/svelteDialog";
    import { copyTo, pickBucketSyncSettings } from "../../../../lib/src/common/utils";
    import type { SetupRemoteBucketInitialData, SetupRemoteBucketResult } from "../resultTypes";

    const default_setting = pickBucketSyncSettings(DEFAULT_SETTINGS);

    let syncSetting = $state<BucketSyncSetting>({ ...default_setting });

    const TYPE_CANCELLED = "cancelled";
    type Props = GuestDialogProps<SetupRemoteBucketResult, SetupRemoteBucketInitialData>;

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
                return msg("Ui.SetupWizard.Common.ErrorCreateReplicator");
            }
            try {
                const result = await replicator.tryConnectRemote(trialRemoteSetting, false);
                if (result) {
                    return "";
                } else {
                    return msg("Ui.SetupWizard.Common.ErrorConnectServer");
                }
            } catch (e) {
                return msg("Ui.SetupWizard.Common.ErrorConnectServerDetail", { error: `${e}` });
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
            error = msg("Ui.SetupWizard.Common.ErrorConnectionTest", { error: `${e}` });
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

<DialogHeader title="Ui.SetupWizard.Bucket.Title" />
<Guidance message="Ui.Bucket.Guidance" />
<InputRow label="Ui.SetupWizard.Bucket.EndpointUrl">
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

<InputRow label="Ui.SetupWizard.Bucket.AccessKeyId">
    <input
        type="text"
        name="s3-access-key-id"
        placeholder={msg("Ui.SetupWizard.Bucket.PlaceholderAccessKeyId")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.accessKey}
    />
</InputRow>

<InputRow label="Ui.SetupWizard.Bucket.SecretAccessKey">
    <Password
        name="s3-secret-access-key"
        placeholder="Ui.SetupWizard.Bucket.PlaceholderSecretAccessKey"
        required
        bind:value={syncSetting.secretKey}
    />
</InputRow>
<InputRow label="Ui.SetupWizard.Bucket.BucketName">
    <input
        type="text"
        name="s3-bucket-name"
        placeholder={msg("Ui.SetupWizard.Bucket.PlaceholderBucketName")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.bucket}
    /></InputRow
>
<InputRow label="Ui.SetupWizard.Bucket.Region">
    <input
        type="text"
        name="s3-region"
        placeholder={msg("Ui.SetupWizard.Bucket.PlaceholderRegion")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.region}
    />
</InputRow>
<InputRow label="Ui.SetupWizard.Bucket.UsePathStyleAccess">
    <input type="checkbox" name="s3-use-path-style" bind:checked={syncSetting.forcePathStyle} />
</InputRow>

<InputRow label="Ui.SetupWizard.Bucket.FolderPrefix">
    <input
        type="text"
        name="s3-folder-prefix"
        placeholder={msg("Ui.SetupWizard.Bucket.PlaceholderFolderPrefix")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.bucketPrefix}
    />
</InputRow>
<InfoNote message="Ui.SetupWizard.Bucket.FolderPrefixDesc" />
<InputRow label="Ui.SetupWizard.Bucket.UseInternalApi">
    <input type="checkbox" name="s3-use-internal-api" bind:checked={syncSetting.useCustomRequestHandler} />
</InputRow>
<InfoNote message="Ui.SetupWizard.Bucket.InternalApiDesc" />

<ExtraItems title="Ui.SetupWizard.Common.AdvancedSettings">
    <InputRow label="Ui.SetupWizard.Common.CustomHeaders">
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
    {msg("Ui.SetupWizard.Common.CheckingConnection")}
{:else}
    <UserDecisions>
        <Decision title="Test Settings and Continue" important disabled={!canProceed} commit={() => checkAndCommit()} />
        <Decision title="Continue anyway" commit={() => commit()} />
        <Decision title="Cancel" commit={() => cancel()} />
    </UserDecisions>
{/if}
