<script lang="ts">
    import { onMount } from "svelte";
    import type { P2PSyncSetting } from "@vrtmrz/livesync-commonlib/compat/common/types";

    import type { P2PReplicatorPaneHost } from "@/features/P2PSync/P2PReplicator/P2PReplicatorPaneHost";

    interface Props {
        host: P2PReplicatorPaneHost;
    }

    let { host }: Props = $props();
    const currentSettings = () => host.services.setting.currentSettings() as P2PSyncSetting;
    const initialSettings = currentSettings();

    let savedTurnServers = $state(initialSettings.P2P_turnServers);
    let savedTurnUsername = $state(initialSettings.P2P_turnUsername);
    let savedTurnCredential = $state(initialSettings.P2P_turnCredential);
    let turnServers = $state(initialSettings.P2P_turnServers);
    let turnUsername = $state(initialSettings.P2P_turnUsername);
    let turnCredential = $state(initialSettings.P2P_turnCredential);

    const isTurnServersModified = $derived(turnServers !== savedTurnServers);
    const isTurnUsernameModified = $derived(turnUsername !== savedTurnUsername);
    const isTurnCredentialModified = $derived(turnCredential !== savedTurnCredential);
    const isModified = $derived(
        isTurnServersModified || isTurnUsernameModified || isTurnCredentialModified
    );

    function loadSettings(settings: P2PSyncSetting): void {
        savedTurnServers = settings.P2P_turnServers;
        savedTurnUsername = settings.P2P_turnUsername;
        savedTurnCredential = settings.P2P_turnCredential;
        turnServers = savedTurnServers;
        turnUsername = savedTurnUsername;
        turnCredential = savedTurnCredential;
    }

    onMount(() =>
        host.services.context.events.onEvent("setting-saved", (settings) => {
            loadSettings(settings as P2PSyncSetting);
        })
    );

    async function save(): Promise<void> {
        await host.services.setting.applyPartial(
            {
                P2P_turnServers: turnServers,
                P2P_turnUsername: turnUsername,
                P2P_turnCredential: turnCredential,
            },
            true
        );
        loadSettings(currentSettings());
    }

    function revert(): void {
        turnServers = savedTurnServers;
        turnUsername = savedTurnUsername;
        turnCredential = savedTurnCredential;
    }
</script>

<section class="browser-p2p-transport-settings">
    <details>
        <summary>Optional TURN server settings</summary>
        <p>
            Configure TURN only when a direct peer-to-peer connection cannot be established.
        </p>
        <label class:is-dirty={isTurnServersModified}>
            <span>TURN Server URLs (comma-separated)</span>
            <input
                type="text"
                placeholder="turn:turn.example.com:3478"
                bind:value={turnServers}
                autocomplete="off"
                spellcheck="false"
                autocorrect="off"
            />
        </label>
        <label class:is-dirty={isTurnUsernameModified}>
            <span>TURN Username</span>
            <input
                type="text"
                placeholder="Enter TURN username"
                bind:value={turnUsername}
                autocomplete="off"
            />
        </label>
        <label class:is-dirty={isTurnCredentialModified}>
            <span>TURN Credential</span>
            <input
                type="password"
                placeholder="Enter TURN credential"
                bind:value={turnCredential}
                autocomplete="new-password"
            />
        </label>
        <div class="actions">
            <button type="button" class="button mod-cta" disabled={!isModified} onclick={save}>
                Save TURN settings
            </button>
            <button type="button" class="button" disabled={!isModified} onclick={revert}>
                Revert TURN settings
            </button>
        </div>
    </details>
</section>

<style>
    .browser-p2p-transport-settings {
        margin-bottom: 1rem;
    }
    p {
        margin: 0.75rem 0;
    }
    label {
        display: grid;
        gap: 0.25rem;
        margin: 0.75rem 0;
    }
    label.is-dirty {
        background-color: var(--background-modifier-error);
    }
    input {
        box-sizing: border-box;
        width: 100%;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
</style>
