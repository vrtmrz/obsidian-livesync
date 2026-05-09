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
        DEFAULT_SETTINGS,
        PREFERRED_SETTING_CLOUDANT,
        PREFERRED_SETTING_SELF_HOSTED,
        RemoteTypes,
        type CouchDBConnection,
        type ObsidianLiveSyncSettings,
    } from "../../../../lib/src/common/types";
    import { isCloudantURI } from "../../../../lib/src/pouchdb/utils_couchdb";

    import { onMount } from "svelte";
    import { getDialogContext, type GuestDialogProps } from "../../../../lib/src/UI/svelteDialog";
    import { copyTo, pickCouchDBSyncSettings } from "../../../../lib/src/common/utils";
    import PanelCouchDBCheck from "./PanelCouchDBCheck.svelte";
    import type { SetupRemoteCouchDBInitialData, SetupRemoteCouchDBResult } from "../resultTypes";

    const default_setting = pickCouchDBSyncSettings(DEFAULT_SETTINGS);

    let syncSetting = $state<CouchDBConnection>({ ...default_setting });
    const TYPE_CANCELLED = "cancelled";
    type Props = GuestDialogProps<SetupRemoteCouchDBResult, SetupRemoteCouchDBInitialData>;
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

    function generateSetting() {
        const connSetting: CouchDBConnection = {
            ...syncSetting,
        };
        const trialSettings: CouchDBConnection = {
            ...connSetting,
            // ...encryptionSettings,
        };
        const preferredSetting = isCloudantURI(syncSetting.couchDB_URI)
            ? PREFERRED_SETTING_CLOUDANT
            : PREFERRED_SETTING_SELF_HOSTED;
        const trialRemoteSetting: ObsidianLiveSyncSettings = {
            ...DEFAULT_SETTINGS,
            ...preferredSetting,
            remoteType: RemoteTypes.REMOTE_COUCHDB,
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
                setResult(pickCouchDBSyncSettings(setting));
                return;
            }
        } catch (e) {
            error = msg("Ui.SetupWizard.Common.ErrorConnectionTest", { error: `${e}` });
            return;
        }
    }
    function commit() {
        const setting = pickCouchDBSyncSettings(generateSetting());
        setResult(setting);
    }
    function cancel() {
        setResult(TYPE_CANCELLED);
    }

    // const isURICloudant = $derived.by(() => {
    //     return syncSetting.couchDB_URI && isCloudantURI(syncSetting.couchDB_URI);
    // });
    // const isURISelfHosted = $derived.by(() => {
    //     return syncSetting.couchDB_URI && !isCloudantURI(syncSetting.couchDB_URI);
    // });
    // const isURISecure = $derived.by(() => {
    //     return syncSetting.couchDB_URI && syncSetting.couchDB_URI.startsWith("https://");
    // });
    const isURIInsecure = $derived.by(() => {
        return !!(syncSetting.couchDB_URI && syncSetting.couchDB_URI.startsWith("http://"));
    });
    const isUseJWT = $derived.by(() => {
        return syncSetting.useJWT;
    });
    const canProceed = $derived.by(() => {
        return (
            syncSetting.couchDB_URI.trim().length > 0 &&
            syncSetting.couchDB_USER.trim().length > 0 &&
            syncSetting.couchDB_PASSWORD.trim().length > 0 &&
            syncSetting.couchDB_DBNAME.trim().length > 0 &&
            (isUseJWT ? syncSetting.jwtKey.trim().length > 0 : true)
        );
    });
    const testSettings = $derived.by(() => {
        return generateSetting();
    });
</script>

<DialogHeader title="Ui.SetupWizard.CouchDB.Title" />
<Guidance message="Ui.CouchDB.Guidance" />
<InputRow label="Ui.SetupWizard.CouchDB.Url">
    <input
        type="text"
        name="couchdb-url"
        placeholder="https://example.com"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        bind:value={syncSetting.couchDB_URI}
        required
        pattern="^https?://.+"
    />
</InputRow>
<InfoNote warning visible={isURIInsecure} message="Ui.SetupWizard.Common.HttpsOnlyMobile" />
<InputRow label="Ui.SetupWizard.CouchDB.Username">
    <input
        type="text"
        name="couchdb-username"
        placeholder={msg("Ui.SetupWizard.CouchDB.PlaceholderUsername")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.couchDB_USER}
    />
</InputRow>
<InputRow label="Ui.SetupWizard.CouchDB.Password">
    <Password
        name="couchdb-password"
        placeholder="Ui.SetupWizard.CouchDB.PlaceholderPassword"
        bind:value={syncSetting.couchDB_PASSWORD}
        required
    />
</InputRow>

<InputRow label="Ui.SetupWizard.CouchDB.DatabaseName">
    <input
        type="text"
        name="couchdb-database"
        placeholder={msg("Ui.SetupWizard.CouchDB.PlaceholderDatabaseName")}
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        pattern="^[a-z0-9][a-z0-9_]*$"
        bind:value={syncSetting.couchDB_DBNAME}
    />
</InputRow>
<InfoNote message="Ui.SetupWizard.CouchDB.DatabaseNameDesc" />
<InputRow label="Ui.SetupWizard.CouchDB.UseInternalApi">
    <input type="checkbox" name="couchdb-use-internal-api" bind:checked={syncSetting.useRequestAPI} />
</InputRow>
<InfoNote message="Ui.SetupWizard.CouchDB.InternalApiDesc" />

<ExtraItems title="Ui.SetupWizard.Common.AdvancedSettings">
    <InputRow label="Ui.SetupWizard.Common.CustomHeaders">
        <textarea
            name="couchdb-custom-headers"
            placeholder="e.g., x-example-header: value\n another-header: value2"
            bind:value={syncSetting.couchDB_CustomHeaders}
            autocapitalize="off"
            spellcheck="false"
            rows="4"
        ></textarea>
    </InputRow>
</ExtraItems>
<ExtraItems title="Ui.SetupWizard.Common.ExperimentalSettings">
    <InputRow label="Ui.SetupWizard.CouchDB.UseJwtAuthentication">
        <input type="checkbox" name="couchdb-use-jwt" bind:checked={syncSetting.useJWT} />
    </InputRow>
    <InputRow label="Ui.SetupWizard.CouchDB.JwtAlgorithm">
        <select bind:value={syncSetting.jwtAlgorithm} disabled={!isUseJWT}>
            <option value="HS256">HS256</option>
            <option value="HS512">HS512</option>
            <option value="ES256">ES256</option>
            <option value="ES512">ES512</option>
        </select>
    </InputRow>
    <InputRow label="Ui.SetupWizard.CouchDB.JwtExpirationDuration">
        <input
            type="text"
            name="couchdb-jwt-exp-duration"
            placeholder="0"
            bind:value={() => `${syncSetting.jwtExpDuration}`, (v) => (syncSetting.jwtExpDuration = parseInt(v) || 0)}
            disabled={!isUseJWT}
        />
    </InputRow>
    <InputRow label="Ui.SetupWizard.CouchDB.JwtKey">
        <textarea
            name="couchdb-jwt-key"
            rows="5"
            autocapitalize="off"
            spellcheck="false"
            placeholder={msg("Ui.SetupWizard.CouchDB.PlaceholderJwtKey")}
            bind:value={syncSetting.jwtKey}
            disabled={!isUseJWT}
        ></textarea>
    </InputRow>
    <InfoNote message="Ui.SetupWizard.CouchDB.JwtKeyDesc" />
    <InputRow label="Ui.SetupWizard.CouchDB.JwtKeyId">
        <input
            type="text"
            name="couchdb-jwt-kid"
            placeholder={msg("Ui.SetupWizard.CouchDB.PlaceholderJwtKeyId")}
            bind:value={syncSetting.jwtKid}
            disabled={!isUseJWT}
        />
    </InputRow>
    <InputRow label="Ui.SetupWizard.CouchDB.JwtSubject">
        <input
            type="text"
            name="couchdb-jwt-sub"
            placeholder={msg("Ui.SetupWizard.CouchDB.PlaceholderJwtSubject")}
            bind:value={syncSetting.jwtSub}
            disabled={!isUseJWT}
        />
    </InputRow>
    <InfoNote warning message="Ui.SetupWizard.CouchDB.JwtWarning" />
</ExtraItems>

<PanelCouchDBCheck trialRemoteSetting={testSettings}></PanelCouchDBCheck>
<hr />

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
