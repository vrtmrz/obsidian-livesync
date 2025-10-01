import { $msg } from "@/lib/src/common/i18n";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { PageFunctions, visibleOnly } from "./SettingPane";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting";
import { EVENT_REQUEST_COPY_SETUP_URI, EVENT_REQUEST_OPEN_SETUP_URI, EVENT_REQUEST_SHOW_SETUP_QR, eventHub } from "@/common/events";
import { DEFAULT_SETTINGS } from "@/lib/src/common/types";

export function pageGettingStarted(
    this: ObsidianLiveSyncSettingTab,
    pageEl: HTMLElement,
    { addPanel } : PageFunctions
) : void {
    // Quick Setup Panel
    void addPanel(
        pageEl, 
        $msg("obsidianLiveSyncSettingTab.titleQuickSetup")).then((pageEl) => {
        
        // Connect via Setup URI
        new Setting(pageEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameConnectSetupURI"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descConnectSetupURI"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnUse")).onClick(() => {
                    //this.closeSetting();
                    eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
                });
            });

        // Manual Setup
        new Setting(pageEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameManualSetup"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descManualSetup"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnStart")).onClick( async () => {
                    await this.enableMinimalSetup();
                });
            });

        // Complete Setup
        new Setting(pageEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameEnableLiveSync"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descEnableLiveSync"))
            .addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", false)))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnEnable")).onClick(async () => {
                    this.editingSettings.isConfigured = true;
                    await this.saveAllDirtySettings();
                    this.plugin.$$askReload();
                });
            });
    });

    // Setup on Other Devices
    void addPanel(
        pageEl, 
        $msg("obsidianLiveSyncSettingTab.titleSetupOtherDevices"),
        undefined,
        visibleOnly(() => this.isConfiguredAs("isConfigured", true))).then((pageEl) => {
        
        // Copy Settings to URI
        new Setting(pageEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameCopySetupURI"))
            .setDesc($msg("obsidianLiveSyncSettingTab.descCopySetupURI"))
            .addButton((text) => {
                text.setButtonText($msg("obsidianLiveSyncSettingTab.btnCopy")).onClick(() => {
                    eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
                });
            });

        // Copy Settings to QR Code
        new Setting(pageEl)
            .setName($msg("Setup.ShowQRCode"))
            .setDesc($msg("Setup.ShowQRCode.Desc"))
            .addButton((text) => {
                text.setButtonText($msg("Setup.ShowQRCode")).onClick( async () => {
                    eventHub.emitEvent(EVENT_REQUEST_SHOW_SETUP_QR);
                });
            });
    });

    // Reset Setup
    void addPanel(pageEl, $msg("obsidianLiveSyncSettingTab.titleReset")).then((pageEl) => {
            new Setting(pageEl)
                .setName($msg("obsidianLiveSyncSettingTab.nameDiscardSettings"))
                .addButton((text) => {
                    text.setButtonText($msg("obsidianLiveSyncSettingTab.btnDiscard"))
                        .onClick(async () => {
                            if (
                                (await this.plugin.confirm.askYesNoDialog(
                                    $msg("obsidianLiveSyncSettingTab.msgDiscardConfirmation"),
                                    { defaultOption: "No" }
                                )) == "yes"
                            ) {
                                this.editingSettings = { ...this.editingSettings, ...DEFAULT_SETTINGS };
                                await this.saveAllDirtySettings();
                                this.plugin.settings = { ...DEFAULT_SETTINGS };
                                await this.plugin.$$saveSettingData();
                                await this.plugin.$$resetLocalDatabase();
                                // await this.plugin.initializeDatabase();
                                this.plugin.$$askReload();
                            }
                        })
                        .setWarning();
                })
                .addOnUpdate(visibleOnly(() => this.isConfiguredAs("isConfigured", true)));
        });

    // Online Tips
}