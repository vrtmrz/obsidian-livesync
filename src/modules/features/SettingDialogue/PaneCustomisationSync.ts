import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG, eventHub } from "@/common/events.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { renderObsidianSetting } from "./ObsidianSettingRenderer.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { enableOnly, visibleOnly } from "./SettingPane.ts";
export function paneCustomisationSync(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    // With great respect, thank you TfTHacker!
    // Refer: https://github.com/TfTHacker/obsidian42-brat/blob/main/src/features/BetaPlugins.ts
    void addPanel(paneEl, "Customization Sync").then((paneEl) => {
        const enableOnlyOnPluginSyncIsNotEnabled = enableOnly(() => this.isConfiguredAs("usePluginSync", false));
        const visibleOnlyOnPluginSyncEnabled = visibleOnly(() => this.isConfiguredAs("usePluginSync", true));

        this.createEl(
            paneEl,
            "div",
            {
                text: "Please set device name to identify this device. This name should be unique among your devices. While not configured, we cannot enable this feature.",
                cls: "op-warn",
            },
            (c) => {},
            visibleOnly(() => this.isConfiguredAs("deviceAndVaultName", ""))
        );
        this.createEl(
            paneEl,
            "div",
            {
                text: "We cannot change the device name while this feature is enabled. Please disable this feature to change the device name.",
                cls: "op-warn-info",
            },
            (c) => {},
            visibleOnly(() => this.isConfiguredAs("usePluginSync", true))
        );

        renderObsidianSetting(paneEl, "deviceAndVaultName", {
            placeHolder: "desktop",
            onUpdate: enableOnlyOnPluginSyncIsNotEnabled,
        });

        renderObsidianSetting(paneEl, "usePluginSyncV2");

        renderObsidianSetting(paneEl, "usePluginSync", {
            onUpdate: enableOnly(() => !this.isConfiguredAs("deviceAndVaultName", "")),
        });

        renderObsidianSetting(paneEl, "autoSweepPlugins", {
            onUpdate: visibleOnlyOnPluginSyncEnabled,
        });

        renderObsidianSetting(paneEl, "autoSweepPluginsPeriodic", {
            onUpdate: visibleOnly(
                () => this.isConfiguredAs("usePluginSync", true) && this.isConfiguredAs("autoSweepPlugins", true)
            ),
        });
        renderObsidianSetting(paneEl, "notifyPluginOrSettingUpdated", {
            onUpdate: visibleOnlyOnPluginSyncEnabled,
        });

        new Setting(paneEl)
            .setName("Open")
            .setDesc("Open the dialog")
            .addButton((button) => {
                button
                    .setButtonText("Open")
                    .setDisabled(false)
                    .onClick(() => {
                        // this.plugin.getAddOn<ConfigSync>(ConfigSync.name)?.showPluginSyncModal();
                        // this.plugin.addOnConfigSync.showPluginSyncModal();
                        eventHub.emitEvent(EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG);
                    });
            })
            .addOnUpdate(visibleOnlyOnPluginSyncEnabled);
    });
}
