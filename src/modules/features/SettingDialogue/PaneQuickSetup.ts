import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { visibleOnly, type PageFunctions } from "./SettingPane.ts";

/** Render setup actions in the pane-based settings interface used before Obsidian 1.13. */
export function paneQuickSetup(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleQuickSetup")).then((panelEl) => {
        new Setting(panelEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameConnectSetupURI"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descConnectSetupURI"))
            .addButton((button) => {
                button.setButtonText($msg("obsidianLiveSyncSettingTab.btnUse")).onClick(() => {
                    this.requestOpenSetupURI();
                });
            });

        new Setting(panelEl)
            .setName($msg("Rerun Onboarding Wizard"))
            .setDesc($msg("Rerun the onboarding wizard to set up Self-hosted LiveSync again."))
            .addButton((button) => {
                button.setButtonText($msg("Rerun Wizard")).onClick(async () => {
                    await this.rerunOnboardingWizard();
                });
            });

        new Setting(panelEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameEnableLiveSync"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descEnableLiveSync"))
            .addOnUpdate(visibleOnly(() => !this.isConfiguredAs("isConfigured", true)))
            .addButton((button) => {
                button.setButtonText($msg("obsidianLiveSyncSettingTab.btnEnable")).onClick(async () => {
                    await this.enableLiveSyncFromSettings();
                });
            });
    });

    void addPanel(
        paneEl,
        `📲 ${$msg("obsidianLiveSyncSettingTab.titleSetupOtherDevices")}`,
        undefined,
        visibleOnly(() => this.isConfiguredAs("isConfigured", true))
    ).then((panelEl) => {
        new Setting(panelEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameCopySetupURI"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descCopySetupURI"))
            .addButton((button) => {
                button.setButtonText($msg("obsidianLiveSyncSettingTab.btnCopy")).onClick(() => {
                    this.requestCopySetupURI();
                });
            });
        new Setting(panelEl)
            .setName($msg("Setup.ShowQRCode"))
            .setDesc($msg("Setup.ShowQRCode.Desc"))
            .addButton((button) => {
                button.setButtonText($msg("Setup.ShowQRCode")).onClick(() => {
                    this.requestShowSetupQRCode();
                });
            });
    });
}
