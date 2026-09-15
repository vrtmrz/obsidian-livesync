<script lang="ts">
    import type { P2PConnectionInfo } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import { iceServerSourceDefinitions, validateTurnSettings } from "@/integrations/iceServerSources";
    import { translateLiveSyncMessage as translate, translateIfAvailable } from "@/common/translation";

    type TurnSettings = Pick<P2PConnectionInfo,
        "P2P_turnServers" | "P2P_turnUsername" | "P2P_turnCredential" | "P2P_iceServerSource" | "encryptedP2PIceServerSource">;
    let { settings = $bindable() }: { settings: TurnSettings } = $props();
    const sourceId = $derived(settings.P2P_iceServerSource?.id ?? (settings.encryptedP2PIceServerSource ? "unavailable" : "manual"));
    const definition = $derived(iceServerSourceDefinitions.find((source) => source.id === sourceId));
    const error = $derived(validateTurnSettings(settings));

    function selectSource(id: string) {
        const selected = iceServerSourceDefinitions.find((source) => source.id === id);
        settings.P2P_iceServerSource = selected
            ? { version: 1, id, configuration: Object.fromEntries(selected.fields.map((field) => [field.key, ""])) }
            : undefined;
        settings.encryptedP2PIceServerSource = "";
    }

    function fieldValue(key: string): string {
        const value = settings.P2P_iceServerSource?.configuration?.[key];
        return typeof value === "string" ? value : "";
    }

    function setField(key: string, value: string) {
        const source = settings.P2P_iceServerSource;
        if (!source) return;
        settings.P2P_iceServerSource = { ...source, configuration: { ...source.configuration, [key]: value } };
    }
</script>

<div class="turn-configuration">
    <label>
        <span>{translate("TURN configuration")}</span>
        <select aria-label={translate("TURN configuration")} name="p2p-turn-source" value={sourceId} onchange={(event) => selectSource(event.currentTarget.value)}>
            <option value="manual">{translate("Manual")}</option>
            {#each iceServerSourceDefinitions as source (source.id)}
                <option value={source.id}>{translate(source.label)}</option>
            {/each}
            {#if sourceId !== "manual" && !definition}
                <option value={sourceId} disabled>{translate("Unsupported TURN configuration")}</option>
            {/if}
        </select>
    </label>
    {#if sourceId === "manual"}
        <label>
            <span>{translate("TURN Server URLs (comma-separated)")}</span>
            <textarea name="p2p-turn-servers" rows="3" placeholder="turn:turn.example.com:3478"
                bind:value={settings.P2P_turnServers} autocapitalize="off" spellcheck="false"></textarea>
        </label>
        <label>
            <span>{translate("TURN Username")}</span>
            <input type="text" name="p2p-turn-username" placeholder={translate("Enter TURN username")} bind:value={settings.P2P_turnUsername}
                autocomplete="off" autocapitalize="off" spellcheck="false" />
        </label>
        <label>
            <span>{translate("TURN Credential")}</span>
            <input type="password" name="p2p-turn-credential" placeholder={translate("Enter TURN credential")} bind:value={settings.P2P_turnCredential}
                autocomplete="new-password" />
        </label>
    {:else if definition}
        {#each definition.fields as field (field.key)}
            <label>
                <span>{translate(field.label)}</span>
                <input type={field.secret ? "password" : "text"} name={`p2p-turn-${field.key}`}
                    value={fieldValue(field.key)} oninput={(event) => setField(field.key, event.currentTarget.value)}
                    autocomplete={field.secret ? "new-password" : "off"} autocapitalize="off" spellcheck="false" />
            </label>
        {/each}
        <p>{translate("The API token is saved with this profile and included in encrypted Setup URI sharing. Temporary TURN credentials are kept in memory only.")}</p>
    {/if}
    {#if error}
        <p role="status" class="turn-error">{translateIfAvailable(error)}</p>
    {/if}
</div>

<style>
    label { display: grid; gap: 0.25rem; margin: 0.75rem 0; }
    input, textarea, select { box-sizing: border-box; width: 100%; }
    p { font-size: var(--font-ui-small, 0.9rem); }
    .turn-error { color: var(--text-error, #b33); }
</style>
