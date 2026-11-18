<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import type { GuestDialogProps } from "@/modules/services/LiveSyncUI/svelteDialog";
    import DialogHeader from "@/modules/services/LiveSyncUI/components/DialogHeader.svelte";
    import { Menu } from "@/deps";
    import InfoNote from "@/modules/services/LiveSyncUI/components/InfoNote.svelte";
    import { $msg as translate } from "@/common/translation";
    import type {
        JoinedDeviceRow,
        JoinedDevicesDialogOptions,
        JoinedDevicesView,
    } from "./types";

    const { setResult, getInitialData }: GuestDialogProps<"close", JoinedDevicesDialogOptions> = $props();
    let options = $state<JoinedDevicesDialogOptions>();
    let view = $state<JoinedDevicesView>();
    let isRefreshing = $state(false);
    let confirmingId = $state<string>();
    let forgettingId = $state<string>();
    let statusMessage = $state("");
    let errorMessage = $state("");
    let savingPreferenceId = $state<string>();
    let preferenceError = $state("");
    let deviceMenu: Menu | undefined;
    let disposed = false;
    const busy = $derived(isRefreshing || forgettingId !== undefined || savingPreferenceId !== undefined);
    const title = translate("Joined devices");

    onMount(() => {
        options = getInitialData?.();
        if (!options) {
            errorMessage = translate(
                "The device information could not be loaded. Close this dialogue and open Joined devices again if the remote configuration has changed."
            );
            return;
        }
        void refreshView();
    });

    onDestroy(() => {
        disposed = true;
        deviceMenu?.hide();
        options?.cancel();
    });

    async function saveVersionNoticesHidden(id: string, hidden: boolean) {
        const dialogOptions = options;
        if (!dialogOptions || disposed || busy) {
            return;
        }
        savingPreferenceId = id;
        preferenceError = "";
        try {
            await dialogOptions.setVersionNoticesHidden(id, hidden);
            if (!disposed && view) {
                view = { ...view, devices: view.devices.map((device) =>
                    device.id === id ? { ...device, versionNoticesHidden: hidden } : device
                ) };
                await refreshView();
            }
        } catch {
            if (!disposed) {
                preferenceError = translate("The notification preference could not be saved. Try again.");
            }
        } finally {
            if (!disposed) {
                savingPreferenceId = undefined;
            }
        }
    }

    async function refreshView(afterForget = false) {
        const dialogOptions = options;
        if (!dialogOptions || disposed || isRefreshing || (forgettingId !== undefined && !afterForget)) return;

        isRefreshing = true;
        errorMessage = "";
        if (!afterForget) {
            statusMessage = "";
            confirmingId = undefined;
        }
        try {
            const refreshedView = await dialogOptions.refresh();
            if (disposed) return;
            view = refreshedView;
        } catch {
            if (!disposed) {
                errorMessage = translate(
                    "The device information could not be loaded. Close this dialogue and open Joined devices again if the remote configuration has changed."
                );
            }
        } finally {
            if (!disposed) isRefreshing = false;
        }
    }

    function openDeviceMenu(event: MouseEvent, device: JoinedDeviceRow) {
        if (disposed || busy || device.self) {
            return;
        }
        deviceMenu?.hide();
        deviceMenu = new Menu().addItem((item) => {
            item.setTitle(translate("Forget device record…"))
                .setIcon("trash-2")
                .setWarning(true)
                .onClick(() => toggleConfirmation(device));
        });
        const button = event.currentTarget as HTMLButtonElement;
        const rect = button.getBoundingClientRect();
        deviceMenu.showAtPosition({ x: rect.right, y: rect.bottom }, button.ownerDocument);
    }

    function toggleConfirmation(device: JoinedDeviceRow) {
        if (disposed || busy || device.self) {
            return;
        }
        confirmingId = confirmingId === device.id ? undefined : device.id;
        errorMessage = "";
        statusMessage = "";
    }

    async function forgetDevice(device: JoinedDeviceRow) {
        const dialogOptions = options;
        if (!dialogOptions || disposed || busy || device.self || confirmingId !== device.id) return;

        forgettingId = device.id;
        confirmingId = undefined;
        errorMessage = "";
        statusMessage = "";
        try {
            const result = await dialogOptions.forget(device.id);
            if (disposed) return;

            if (result === "forgotten") {
                statusMessage = translate("The device record was forgotten.");
                await refreshView(true);
            } else if (result === "not-found") {
                statusMessage = translate("The device record was already absent.");
                await refreshView(true);
            } else if (result === "conflict") {
                errorMessage = translate(
                    "The device list changed while you were trying to forget this device. Refresh the list before trying again."
                );
            } else {
                errorMessage = translate(
                    "This remote does not support conditional updates, so the device record could not be removed."
                );
            }
        } catch {
            if (!disposed) {
                errorMessage = translate(
                    "Joined devices could not be updated. Refresh the list and try again. If the remote configuration has changed, close this dialogue and open Joined devices again."
                );
            }
        } finally {
            if (!disposed) forgettingId = undefined;
        }
    }

    function formatLastConnected(timestamp: number | undefined) {
        if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) return translate("Not recorded");
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return translate("Not recorded");
        return date.toLocaleString();
    }
</script>

<DialogHeader {title} />
<div class="joined-devices-dialog">
    <p>
        {translate("This list shows device information recorded by the remote. It does not show whether a device is online now.")}
    </p>

    <InfoNote
        message="Synchronisation between different plug-in versions is generally safe unless the connection is explicitly blocked. However, it may be less efficient or use more storage, and P2P synchronisation may be unavailable."
    />

    <p class="preference-description">
        {translate("Version notice choices are saved only for this Vault on this device. Compatibility checks remain enabled.")}
    </p>
    {#if preferenceError}
        <p class="error-message" role="alert">{preferenceError}</p>
    {/if}

    {#if view}
        {#if !view.milestonePresent}
            <p class="state-message">{translate("This remote does not currently have a record of joined devices.")}</p>
        {/if}
        {#if view.cleaned}
            <p class="state-message">
                {translate(
                    "This remote has been cleaned. Use the existing recovery process to join devices again as needed."
                )}
            </p>
        {/if}
        {#if view.locked}
            <p class="state-message">
                {translate(
                    "This remote is locked. Use the existing recovery process for devices that need to join again."
                )}
            </p>
        {/if}
    {/if}

    {#if errorMessage}
        <p class="error-message" role="alert">{errorMessage}</p>
    {/if}
    {#if statusMessage}
        <p class="status-message" role="status">{statusMessage}</p>
    {/if}
    {#if isRefreshing && !view}
        <p role="status">{translate("Loading joined devices…")}</p>
    {/if}

    {#if view}
        {#if view.devices.length > 0}
            <ul class="device-list">
                {#each view.devices as device (device.id)}
                    <li class="device-card">
                        <div class="device-heading">
                            <div class="device-identity">
                                {#if device.self}
                                    <span class="device-badge">{translate("This device")}</span>
                                {/if}
                                <code class="device-id">{device.id}</code>
                            </div>
                            <div class="device-badges">
                                <span class="device-badge">
                                    {device.accepted ? translate("Accepted") : translate("Not accepted")}
                                </span>
                                {#if device.lockedOut}
                                    <span class="device-badge device-badge-warning">{translate("Locked out")}</span>
                                {/if}
                            </div>
                        </div>

                        {#if device.self && device.lockedOut}
                            <p class="state-message">
                                {translate(
                                    "This device has been locked out. Use the existing recovery process to join again."
                                )}
                            </p>
                        {/if}

                        <dl class="device-details">
                            <div>
                                <dt>{translate("Platform")}</dt>
                                <dd>{device.platform || translate("Unknown platform")}</dd>
                            </div>
                            <div>
                                <dt>{translate("Plug-in version")}</dt>
                                <dd>{device.pluginVersion || translate("Not recorded")}</dd>
                            </div>
                            <div>
                                <dt>{translate("App version")}</dt>
                                <dd>{device.appVersion || translate("Not recorded")}</dd>
                            </div>
                            <div>
                                <dt>{translate("Last recorded")}</dt>
                                <dd>{formatLastConnected(device.lastConnected)}</dd>
                            </div>
                        </dl>

                        {#if !device.self}
                            {#if confirmingId === device.id}
                                <div class="forget-confirmation">
                                    <p><strong>{translate("Forget this device record?")}</strong></p>
                                    <p>
                                        {translate("This removes only this device's record from the remote.")}
                                    </p>
                                    <p>
                                        {translate(
                                            "Forgetting the record does not delete Vault files or revoke credentials."
                                        )}
                                    </p>
                                    <p>
                                        {view.locked
                                            ? translate(
                                                  "This remote is locked. If the device returns, use the existing recovery process to join it again."
                                              )
                                            : translate("This remote is unlocked. A device that returns can register again.")}
                                    </p>
                                    <div class="device-actions">
                                        <button disabled={busy} onclick={() => toggleConfirmation(device)}>
                                            {translate("Cancel")}
                                        </button>
                                        <button
                                            class="mod-warning"
                                            disabled={busy}
                                            onclick={() => void forgetDevice(device)}
                                        >
                                            {translate("Forget device record")}
                                        </button>
                                    </div>
                                </div>
                            {:else}
                                <div class="device-actions device-primary-actions">
                                    {#if forgettingId === device.id}
                                        <span role="status">{translate("Forgetting…")}</span>
                                    {/if}
                                    <button
                                        class="version-notice-action"
                                        disabled={busy}
                                        onclick={() => void saveVersionNoticesHidden(device.id, !device.versionNoticesHidden)}
                                    >
                                        {device.versionNoticesHidden
                                            ? translate("Unmute version notices")
                                            : translate("Mute version notices")}
                                    </button>
                                    <button
                                        class="device-more-actions"
                                        aria-label={translate("More actions for ${DEVICE}", { DEVICE: device.id })}
                                        title={translate("More actions for ${DEVICE}", { DEVICE: device.id })}
                                        aria-haspopup="menu"
                                        disabled={busy}
                                        onclick={(event) => openDeviceMenu(event, device)}
                                    >
                                        …
                                    </button>
                                </div>
                            {/if}
                        {/if}
                    </li>
                {/each}
            </ul>
        {:else if !isRefreshing}
            <p>{translate("No joined devices are recorded on this remote.")}</p>
        {/if}
    {/if}

    <div class="dialog-controls">
        <button disabled={busy} onclick={() => void refreshView()}>{translate("Refresh")}</button>
        <button onclick={() => setResult("close")}>{translate("Close")}</button>
    </div>
</div>

<style>
    .device-actions.device-primary-actions {
        flex-wrap: nowrap;
    }

    .device-primary-actions .version-notice-action {
        flex: 0 1 auto;
        min-width: 0;
        margin: 0;
    }

    .device-primary-actions .device-more-actions {
        flex: 0 0 44px;
        min-width: 44px;
        margin: 0;
        padding-inline: var(--size-4-2);
    }

    .preference-description {
        color: var(--text-muted);
    }

    .joined-devices-dialog {
        display: flex;
        flex-direction: column;
        gap: var(--size-4-2);
        min-width: 0;
        max-width: 100%;
    }

    p {
        margin: 0;
        overflow-wrap: anywhere;
    }

    .state-message,
    .forget-confirmation {
        border-left: 3px solid var(--interactive-accent);
        padding: var(--size-4-2);
        background: var(--background-secondary);
    }

    .error-message {
        color: var(--text-error);
    }

    .device-list {
        display: grid;
        gap: var(--size-4-2);
        list-style: none;
        margin: 0;
        min-width: 0;
        padding: 0;
    }

    .device-card {
        display: flex;
        flex-direction: column;
        gap: var(--size-4-2);
        min-width: 0;
        overflow-wrap: anywhere;
        border: 1px solid var(--background-modifier-border);
        border-radius: var(--radius-m);
        padding: var(--size-4-3);
    }

    .device-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--size-4-2);
        min-width: 0;
    }

    .device-identity,
    .device-badges {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--size-4-2);
        min-width: 0;
    }

    .device-id {
        display: block;
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        white-space: normal;
    }

    .device-badge {
        border-radius: var(--radius-s);
        background: var(--background-secondary);
        padding: 0 var(--size-4-2);
        font-size: var(--font-ui-smaller);
    }

    .device-badge-warning {
        color: var(--text-warning);
    }

    .device-details {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
        gap: var(--size-4-2) var(--size-4-4);
        margin: 0;
        min-width: 0;
    }

    .device-details > div {
        min-width: 0;
    }

    dt {
        color: var(--text-muted);
        font-size: var(--font-ui-smaller);
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }

    .forget-confirmation {
        display: flex;
        flex-direction: column;
        gap: var(--size-4-2);
        min-width: 0;
    }

    .device-actions,
    .dialog-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: var(--size-4-2);
    }

    button {
        min-height: 44px;
    }

    @media (max-width: 480px) {
        .device-card {
            padding: var(--size-4-2);
        }

        .device-details {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>
