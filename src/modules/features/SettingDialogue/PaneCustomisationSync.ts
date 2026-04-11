import { $msg } from "../../../lib/src/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG, eventHub } from "../../../common/events.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { enableOnly, visibleOnly } from "./SettingPane.ts";
export function paneCustomisationSync(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    // With great respect, thank you TfTHacker!
    // Refer: https://github.com/TfTHacker/obsidian42-brat/blob/main/src/features/BetaPlugins.ts
    void addPanel(paneEl, $msg("Ui.Settings.CustomizationSync.Panel")).then((paneEl) => {
        const enableOnlyOnPluginSyncIsNotEnabled = enableOnly(() => this.isConfiguredAs("usePluginSync", false));
        const visibleOnlyOnPluginSyncEnabled = visibleOnly(() => this.isConfiguredAs("usePluginSync", true));

        this.createEl(
            paneEl,
            "div",
            {
                text: $msg("Ui.Settings.CustomizationSync.WarnSetDeviceName"),
                cls: "op-warn",
            },
            (c) => {},
            visibleOnly(() => this.isConfiguredAs("deviceAndVaultName", ""))
        );
        this.createEl(
            paneEl,
            "div",
            {
                text: $msg("Ui.Settings.CustomizationSync.WarnChangeDeviceName"),
                cls: "op-warn-info",
            },
            (c) => {},
            visibleOnly(() => this.isConfiguredAs("usePluginSync", true))
        );

        new Setting(paneEl).autoWireText("deviceAndVaultName", {
            placeHolder: "desktop",
            onUpdate: enableOnlyOnPluginSyncIsNotEnabled,
        });

        new Setting(paneEl).autoWireToggle("usePluginSyncV2");

        new Setting(paneEl).autoWireToggle("usePluginSync", {
            onUpdate: enableOnly(() => !this.isConfiguredAs("deviceAndVaultName", "")),
        });

        new Setting(paneEl).autoWireToggle("autoSweepPlugins", {
            onUpdate: visibleOnlyOnPluginSyncEnabled,
        });

        new Setting(paneEl).autoWireToggle("autoSweepPluginsPeriodic", {
            onUpdate: visibleOnly(
                () => this.isConfiguredAs("usePluginSync", true) && this.isConfiguredAs("autoSweepPlugins", true)
            ),
        });
        new Setting(paneEl).autoWireToggle("notifyPluginOrSettingUpdated", {
            onUpdate: visibleOnlyOnPluginSyncEnabled,
        });

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Common.Open"))
            .setDesc($msg("Ui.Settings.CustomizationSync.OpenDesc"))
            .addButton((button) => {
                button
                    .setButtonText($msg("Ui.Settings.Common.Open"))
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
