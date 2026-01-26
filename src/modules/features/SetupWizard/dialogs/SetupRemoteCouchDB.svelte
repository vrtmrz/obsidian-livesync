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

    const default_setting = pickCouchDBSyncSettings(DEFAULT_SETTINGS);

    let syncSetting = $state<CouchDBConnection>({ ...default_setting });
    type ResultType = typeof TYPE_CANCELLED | CouchDBConnection;
    const TYPE_CANCELLED = "cancelled";
    type Props = GuestDialogProps<ResultType, CouchDBConnection>;
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
                setResult(pickCouchDBSyncSettings(setting));
                return;
            }
        } catch (e) {
            error = `Error during connection test: ${e}`;
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

<DialogHeader title="CouchDB Configuration" />
<Guidance>Please enter the CouchDB server information below.</Guidance>
<InputRow label="URL">
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
<InfoNote warning visible={isURIInsecure}>We can use only Secure (HTTPS) connections on Obsidian Mobile.</InfoNote>
<InputRow label="Username">
    <input
        type="text"
        name="couchdb-username"
        placeholder="Enter your username"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        bind:value={syncSetting.couchDB_USER}
    />
</InputRow>
<InputRow label="Password">
    <Password
        name="couchdb-password"
        placeholder="Enter your password"
        bind:value={syncSetting.couchDB_PASSWORD}
        required
    />
</InputRow>

<InputRow label="Database Name">
    <input
        type="text"
        name="couchdb-database"
        placeholder="Enter your database name"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        required
        pattern="^[a-z0-9][a-z0-9_]*$"
        bind:value={syncSetting.couchDB_DBNAME}
    />
</InputRow>
<InfoNote>
    You cannot use capital letters, spaces, or special characters in the database name. And not allowed to start with an
    underscore (_).
</InfoNote>
<InputRow label="Use Internal API">
    <input type="checkbox" name="couchdb-use-internal-api" bind:checked={syncSetting.useRequestAPI} />
</InputRow>
<InfoNote>
    If you cannot avoid CORS issues, you might want to try this option. It uses Obsidian's internal API to communicate
    with the CouchDB server. Not compliant with web standards, but works. Note that this might break in future Obsidian
    versions.
</InfoNote>

<ExtraItems title="Advanced Settings">
    <InputRow label="Custom Headers">
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
<ExtraItems title="Experimental Settings">
    <InputRow label="Use JWT Authentication">
        <input type="checkbox" name="couchdb-use-jwt" bind:checked={syncSetting.useJWT} />
    </InputRow>
    <InputRow label="JWT Algorithm">
        <select bind:value={syncSetting.jwtAlgorithm} disabled={!isUseJWT}>
            <option value="HS256">HS256</option>
            <option value="HS512">HS512</option>
            <option value="ES256">ES256</option>
            <option value="ES512">ES512</option>
        </select>
    </InputRow>
    <InputRow label="JWT Expiration Duration (minutes)">
        <input
            type="text"
            name="couchdb-jwt-exp-duration"
            placeholder="0"
            bind:value={() => `${syncSetting.jwtExpDuration}`, (v) => (syncSetting.jwtExpDuration = parseInt(v) || 0)}
            disabled={!isUseJWT}
        />
    </InputRow>
    <InputRow label="JWT Key">
        <textarea
            name="couchdb-jwt-key"
            rows="5"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Enter your JWT secret or private key"
            bind:value={syncSetting.jwtKey}
            disabled={!isUseJWT}
        ></textarea>
    </InputRow>
    <InfoNote>
        For HS256/HS512 algorithms, provide the shared secret key. For ES256/ES512 algorithms, provide the pkcs8
        PEM-formatted private key.
    </InfoNote>
    <InputRow label="JWT Key ID (kid)">
        <input
            type="text"
            name="couchdb-jwt-kid"
            placeholder="Enter your JWT Key ID"
            bind:value={syncSetting.jwtKid}
            disabled={!isUseJWT}
        />
    </InputRow>
    <InputRow label="JWT Subject (sub)">
        <input
            type="text"
            name="couchdb-jwt-sub"
            placeholder="Enter your JWT Subject (CouchDB Username)"
            bind:value={syncSetting.jwtSub}
            disabled={!isUseJWT}
        />
    </InputRow>
    <InfoNote warning>
        JWT (JSON Web Token) authentication allows you to securely authenticate with the CouchDB server using tokens.
        Ensure that your CouchDB server is configured to accept JWTs and that the provided key and settings match the
        server's configuration. Incidentally, I have not verified it very thoroughly.
    </InfoNote>
</ExtraItems>

<PanelCouchDBCheck trialRemoteSetting={testSettings}></PanelCouchDBCheck>
<hr />

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
