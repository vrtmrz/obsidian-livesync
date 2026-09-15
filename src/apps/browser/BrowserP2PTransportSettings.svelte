<script lang="ts">
    import { onMount } from "svelte";
    import { upsertRemoteConfigurationInPlace } from "@vrtmrz/livesync-commonlib/remote-configurations";
    import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import type { P2PSyncSetting } from "@vrtmrz/livesync-commonlib/compat/common/types";
    import type { P2PReplicatorPaneHost } from "@/features/P2PSync/P2PReplicator/P2PReplicatorPaneHost";
    import TurnConfiguration from "@/features/P2PSync/TurnConfiguration.svelte";
    import { validateTurnSettings } from "@/integrations/iceServerSources";

    let { host }: { host: P2PReplicatorPaneHost } = $props();
    const currentSettings = () => host.services.setting.currentSettings() as P2PSyncSetting;
    function turnSettings(settings: P2PSyncSetting) {
        return {
            P2P_turnServers: settings.P2P_turnServers,
            P2P_turnUsername: settings.P2P_turnUsername,
            P2P_turnCredential: settings.P2P_turnCredential,
            P2P_iceServerSource: structuredClone(settings.P2P_iceServerSource),
            encryptedP2PIceServerSource: settings.encryptedP2PIceServerSource,
        };
    }
    let draft = $state(turnSettings(currentSettings()));
    let saved = $state(JSON.stringify(turnSettings(currentSettings())));
    const isModified = $derived(JSON.stringify(draft) !== saved);
    const sourceError = $derived(validateTurnSettings(draft));

    function loadSettings(settings: P2PSyncSetting): void {
        const next = turnSettings(settings);
        draft = next;
        saved = JSON.stringify(next);
    }
    onMount(() => host.services.context.events.onEvent("setting-saved", (settings) => loadSettings(settings as P2PSyncSetting)));

    async function save(): Promise<void> {
        if (sourceError) return;
        const values = $state.snapshot(draft);
        await host.services.setting.updateSettings((settings) => {
            const next = { ...settings, ...values, remoteConfigurations: { ...settings.remoteConfigurations } };
            const profileId = settings.P2P_ActiveRemoteConfigurationId ||
                (settings.remoteType === REMOTE_P2P ? settings.activeConfigurationId : "");
            if (profileId && next.remoteConfigurations[profileId]) {
                upsertRemoteConfigurationInPlace(next, "p2p", { id: profileId });
            }
            return next;
        }, true);
        loadSettings(currentSettings());
    }
</script>

<section class="browser-p2p-transport-settings">
    <details>
        <summary>Optional TURN server settings</summary>
        <p>Configure TURN only when a direct peer-to-peer connection cannot be established.</p>
        <TurnConfiguration bind:settings={draft} />
        <div class="actions">
            <button type="button" class="button mod-cta" disabled={!isModified || !!sourceError} onclick={save}>
                Save TURN settings
            </button>
            <button type="button" class="button" disabled={!isModified} onclick={() => loadSettings(currentSettings())}>
                Revert TURN settings
            </button>
        </div>
    </details>
</section>

<style>
    .browser-p2p-transport-settings { margin-bottom: 1rem; }
    p { margin: 0.75rem 0; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
</style>
