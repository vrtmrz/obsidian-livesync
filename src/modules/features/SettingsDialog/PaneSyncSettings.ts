import {
    type ObsidianLiveSyncSettings,
    LOG_LEVEL_NOTICE,
    REMOTE_COUCHDB,
    LEVEL_ADVANCED,
} from "../../../lib/src/common/types.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { EVENT_REQUEST_COPY_SETUP_URI, eventHub } from "../../../common/events.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
export function paneSyncSettings(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    this.createEl(paneEl, "div", {
        text: $msg("obsidianLiveSyncSettingTab.msgSelectAndApplyPreset"),
        cls: "wizardOnly",
    }).addClasses(["op-warn-info"]);

    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleSynchronizationPreset")).then((paneEl) => {
        const options: Record<string, string> =
            this.editingSettings.remoteType == REMOTE_COUCHDB
                ? {
                    NONE: "",
                    LIVESYNC: $msg("obsidianLiveSyncSettingTab.optionLiveSync"),
                    PERIODIC: $msg("obsidianLiveSyncSettingTab.optionPeriodicWithBatch"),
                    DISABLE: $msg("obsidianLiveSyncSettingTab.optionDisableAllAutomatic"),
                }
                : {
                    NONE: "",
                    PERIODIC: $msg("obsidianLiveSyncSettingTab.optionPeriodicWithBatch"),
                    DISABLE: $msg("obsidianLiveSyncSettingTab.optionDisableAllAutomatic"),
                };

        new Setting(paneEl)
            .autoWireDropDown("preset", {
                options: options,
                holdValue: true,
            })
            .addButton((button) => {
                button.setButtonText($msg("obsidianLiveSyncSettingTab.btnApply"));
                button.onClick(async () => {
                    // await this.saveSettings(["preset"]);
                    await this.saveAllDirtySettings();
                });
            });

        this.addOnSaved("preset", async (currentPreset) => {
            if (currentPreset == "") {
                Logger($msg("obsidianLiveSyncSettingTab.logSelectAnyPreset"), LOG_LEVEL_NOTICE);
                return;
            }
            const presetAllDisabled = {
                batchSave: false,
                liveSync: false,
                periodicReplication: false,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnStart: false,
                syncOnFileOpen: false,
                syncAfterMerge: false,
            } as Partial<ObsidianLiveSyncSettings>;
            const presetLiveSync = {
                ...presetAllDisabled,
                liveSync: true,
            } as Partial<ObsidianLiveSyncSettings>;
            const presetPeriodic = {
                ...presetAllDisabled,
                batchSave: true,
                periodicReplication: true,
                syncOnSave: false,
                syncOnEditorSave: false,
                syncOnStart: true,
                syncOnFileOpen: true,
                syncAfterMerge: true,
            } as Partial<ObsidianLiveSyncSettings>;

            if (currentPreset == "LIVESYNC") {
                this.editingSettings = {
                    ...this.editingSettings,
                    ...presetLiveSync,
                };
                Logger($msg("obsidianLiveSyncSettingTab.logConfiguredLiveSync"), LOG_LEVEL_NOTICE);
            } else if (currentPreset == "PERIODIC") {
                this.editingSettings = {
                    ...this.editingSettings,
                    ...presetPeriodic,
                };
                Logger($msg("obsidianLiveSyncSettingTab.logConfiguredPeriodic"), LOG_LEVEL_NOTICE);
            } else {
                Logger($msg("obsidianLiveSyncSettingTab.logConfiguredDisabled"), LOG_LEVEL_NOTICE);
                this.editingSettings = {
                    ...this.editingSettings,
                    ...presetAllDisabled,
                };
            }

            if (this.inWizard) {
                this.closeSetting();
                this.inWizard = false;
                if (!this.editingSettings.isConfigured) {
                    this.editingSettings.isConfigured = true;
                    await this.saveAllDirtySettings();
                    await this.plugin.$$realizeSettingSyncMode();
                    await this.rebuildDB("localOnly");
                    // this.resetEditingSettings();
                    if (
                        (await this.plugin.confirm.askYesNoDialog(
                            $msg("obsidianLiveSyncSettingTab.msgGenerateSetupURI"),
                            {
                                defaultOption: "Yes",
                                title: $msg("obsidianLiveSyncSettingTab.titleCongratulations"),
                            }
                        )) == "yes"
                    ) {
                        eventHub.emitEvent(EVENT_REQUEST_COPY_SETUP_URI);
                    }
                } else {
                    if (this.isNeedRebuildLocal() || this.isNeedRebuildRemote()) {
                        await this.confirmRebuild();
                    } else {
                        await this.saveAllDirtySettings();
                        await this.plugin.$$realizeSettingSyncMode();
                        this.plugin.$$askReload();
                    }
                }
            } else {
                await this.saveAllDirtySettings();
                await this.plugin.$$realizeSettingSyncMode();
            }
        });
    });


    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleUpdateThinning"),
        undefined,
        visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"))
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("batchSave");
        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("batchSaveMinimumDelay", {
            acceptZero: true,
            onUpdate: visibleOnly(() => this.isConfiguredAs("batchSave", true)),
        });
        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("batchSaveMaximumDelay", {
            acceptZero: true,
            onUpdate: visibleOnly(() => this.isConfiguredAs("batchSave", true)),
        });
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleSyncSettingsViaMarkdown"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        new Setting(paneEl).autoWireText("settingSyncFile", { holdValue: true }).addApplyButton(["settingSyncFile"]);

        new Setting(paneEl).autoWireToggle("writeCredentialsForSettingSync");

        new Setting(paneEl).autoWireToggle("notifyAllSettingSyncFile");
    });
}
