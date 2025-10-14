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
                    await this.services.setting.realiseSetting();
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
                        await this.services.setting.realiseSetting();
                        this.services.appLifecycle.askRestart();
                    }
                }
            } else {
                await this.saveAllDirtySettings();
                await this.services.setting.realiseSetting();
            }
        });
    });
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleSynchronizationMethod")).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        // const onlyOnLiveSync = visibleOnly(() => this.isConfiguredAs("syncMode", "LIVESYNC"));
        const onlyOnNonLiveSync = visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"));
        const onlyOnPeriodic = visibleOnly(() => this.isConfiguredAs("syncMode", "PERIODIC"));

        const optionsSyncMode =
            this.editingSettings.remoteType == REMOTE_COUCHDB
                ? {
                      ONEVENTS: $msg("obsidianLiveSyncSettingTab.optionOnEvents"),
                      PERIODIC: $msg("obsidianLiveSyncSettingTab.optionPeriodicAndEvents"),
                      LIVESYNC: $msg("obsidianLiveSyncSettingTab.optionLiveSync"),
                  }
                : {
                      ONEVENTS: $msg("obsidianLiveSyncSettingTab.optionOnEvents"),
                      PERIODIC: $msg("obsidianLiveSyncSettingTab.optionPeriodicAndEvents"),
                  };

        new Setting(paneEl)
            .autoWireDropDown("syncMode", {
                //@ts-ignore
                options: optionsSyncMode,
            })
            .setClass("wizardHidden");
        this.addOnSaved("syncMode", async (value) => {
            this.editingSettings.liveSync = false;
            this.editingSettings.periodicReplication = false;
            if (value == "LIVESYNC") {
                this.editingSettings.liveSync = true;
            } else if (value == "PERIODIC") {
                this.editingSettings.periodicReplication = true;
            }
            await this.saveSettings(["liveSync", "periodicReplication"]);

            await this.services.setting.realiseSetting();
        });

        new Setting(paneEl)
            .autoWireNumeric("periodicReplicationInterval", {
                clampMax: 5000,
                onUpdate: onlyOnPeriodic,
            })
            .setClass("wizardHidden");

        new Setting(paneEl).autoWireNumeric("syncMinimumInterval", {
            onUpdate: onlyOnNonLiveSync,
        });
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("syncOnSave", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncOnEditorSave", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("syncOnFileOpen", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("syncOnStart", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("syncAfterMerge", { onUpdate: onlyOnNonLiveSync });
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
        $msg("obsidianLiveSyncSettingTab.titleDeletionPropagation"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("trashInsteadDelete");

        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("doNotDeleteFolder");
    });
    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleConflictResolution"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("resolveConflictsByNewerFile");

        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("checkConflictOnlyOnOpen");

        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("showMergeDialogOnlyOnActive");
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

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleHiddenFiles"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        const LABEL_ENABLED = $msg("obsidianLiveSyncSettingTab.labelEnabled");
        const LABEL_DISABLED = $msg("obsidianLiveSyncSettingTab.labelDisabled");

        const hiddenFileSyncSetting = new Setting(paneEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameHiddenFileSynchronization"))
            .setClass("wizardHidden");
        const hiddenFileSyncSettingEl = hiddenFileSyncSetting.settingEl;
        const hiddenFileSyncSettingDiv = hiddenFileSyncSettingEl.createDiv("");
        hiddenFileSyncSettingDiv.innerText = this.editingSettings.syncInternalFiles ? LABEL_ENABLED : LABEL_DISABLED;
        if (this.editingSettings.syncInternalFiles) {
            new Setting(paneEl)
                .setName($msg("obsidianLiveSyncSettingTab.nameDisableHiddenFileSync"))
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText($msg("obsidianLiveSyncSettingTab.btnDisable")).onClick(async () => {
                        this.editingSettings.syncInternalFiles = false;
                        await this.saveAllDirtySettings();
                        this.display();
                    });
                });
        } else {
            new Setting(paneEl)
                .setName($msg("obsidianLiveSyncSettingTab.nameEnableHiddenFileSync"))
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText("Merge").onClick(async () => {
                        this.closeSetting();
                        // this.resetEditingSettings();
                        await this.services.setting.enableOptionalFeature("MERGE");
                    });
                })
                .addButton((button) => {
                    button.setButtonText("Fetch").onClick(async () => {
                        this.closeSetting();
                        // this.resetEditingSettings();
                        await this.services.setting.enableOptionalFeature("FETCH");
                    });
                })
                .addButton((button) => {
                    button.setButtonText("Overwrite").onClick(async () => {
                        this.closeSetting();
                        // this.resetEditingSettings();
                        await this.services.setting.enableOptionalFeature("OVERWRITE");
                    });
                });
        }

        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("suppressNotifyHiddenFilesChange", {});
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("syncInternalFilesBeforeReplication", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("watchInternalFileChanges", true)),
        });

        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("syncInternalFilesInterval", {
            clampMin: 10,
            acceptZero: true,
        });
    });
}
