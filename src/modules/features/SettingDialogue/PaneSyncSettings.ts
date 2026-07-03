import { type ObsidianLiveSyncSettings, LOG_LEVEL_NOTICE, REMOTE_COUCHDB, LEVEL_ADVANCED } from "@lib/common/types.ts";
import { Logger } from "@lib/common/logger.ts";
import { $msg } from "@lib/common/i18n.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { renderObsidianApplyButton, renderObsidianSetting } from "./ObsidianSettingRenderer.ts";
import { EVENT_REQUEST_COPY_SETUP_URI, eventHub } from "@/common/events.ts";
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

        renderObsidianSetting(paneEl, "preset", {
            options: options,
            holdValue: true,
        }).addButton((button) => {
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
                    await this.services.control.applySettings();
                    await this.rebuildDB("localOnly");
                    // this.resetEditingSettings();
                    if (
                        (await this.core.confirm.askYesNoDialog(
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
                        await this.services.control.applySettings();
                        this.services.appLifecycle.askRestart();
                    }
                }
            } else {
                await this.saveAllDirtySettings();
                await this.services.control.applySettings();
            }
        });
    });
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleSynchronizationMethod")).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        // const onlyOnLiveSync = visibleOnly(() => this.isConfiguredAs("syncMode", "LIVESYNC"));
        const onlyOnNonLiveSync = visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"));
        const onlyOnPeriodic = visibleOnly(() => this.isConfiguredAs("syncMode", "PERIODIC"));

        const optionsSyncMode: Record<string, string> =
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

        renderObsidianSetting(paneEl, "syncMode", {
            options: optionsSyncMode,
        }).setClass("wizardHidden");
        this.addOnSaved("syncMode", async (value) => {
            this.editingSettings.liveSync = false;
            this.editingSettings.periodicReplication = false;
            if (value == "LIVESYNC") {
                this.editingSettings.liveSync = true;
            } else if (value == "PERIODIC") {
                this.editingSettings.periodicReplication = true;
            }
            await this.saveSettings(["liveSync", "periodicReplication"]);

            await this.services.control.applySettings();
        });

        renderObsidianSetting(paneEl, "periodicReplicationInterval", {
            clampMax: 5000,
            onUpdate: onlyOnPeriodic,
        }).setClass("wizardHidden");

        renderObsidianSetting(paneEl, "syncMinimumInterval", {
            onUpdate: onlyOnNonLiveSync,
        });
        renderObsidianSetting(paneEl, "syncOnSave", { onUpdate: onlyOnNonLiveSync }).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "syncOnEditorSave", { onUpdate: onlyOnNonLiveSync }).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "syncOnFileOpen", { onUpdate: onlyOnNonLiveSync }).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "syncOnStart", { onUpdate: onlyOnNonLiveSync }).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "syncAfterMerge", { onUpdate: onlyOnNonLiveSync }).setClass("wizardHidden");
        // Desktop app only, and only for the sync modes that keep a background replication channel
        // (LiveSync and Periodic). Ignored on mobile, where suspending preserves battery. The
        // visibility predicate mirrors the runtime guard in ModuleObsidianEvents.
        if (!this.services.API.isMobile()) {
            renderObsidianSetting(paneEl, "keepReplicationActiveInBackground", {
                onUpdate: visibleOnly(
                    () => this.isConfiguredAs("syncMode", "LIVESYNC") || this.isConfiguredAs("syncMode", "PERIODIC")
                ),
            }).setClass("wizardHidden");
        }
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleUpdateThinning"),
        undefined,
        visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"))
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        renderObsidianSetting(paneEl, "batchSave").setClass("wizardHidden");
        renderObsidianSetting(paneEl, "batchSaveMinimumDelay", {
            acceptZero: true,
            onUpdate: visibleOnly(() => this.isConfiguredAs("batchSave", true)),
        }).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "batchSaveMaximumDelay", {
            acceptZero: true,
            onUpdate: visibleOnly(() => this.isConfiguredAs("batchSave", true)),
        }).setClass("wizardHidden");
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleDeletionPropagation"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        renderObsidianSetting(paneEl, "trashInsteadDelete").setClass("wizardHidden");

        renderObsidianSetting(paneEl, "doNotDeleteFolder").setClass("wizardHidden");
    });
    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleConflictResolution"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        renderObsidianSetting(paneEl, "resolveConflictsByNewerFile").setClass("wizardHidden");

        renderObsidianSetting(paneEl, "checkConflictOnlyOnOpen").setClass("wizardHidden");

        renderObsidianSetting(paneEl, "showMergeDialogOnlyOnActive").setClass("wizardHidden");
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleSyncSettingsViaMarkdown"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        paneEl.addClass("wizardHidden");
        renderObsidianSetting(paneEl, "settingSyncFile");
        renderObsidianApplyButton(paneEl, "setting-sync-file");

        renderObsidianSetting(paneEl, "writeCredentialsForSettingSync");

        renderObsidianSetting(paneEl, "notifyAllSettingSyncFile");
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

        renderObsidianSetting(paneEl, "suppressNotifyHiddenFilesChange", {}).setClass("wizardHidden");
        renderObsidianSetting(paneEl, "syncInternalFilesBeforeReplication", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("watchInternalFileChanges", true)),
        }).setClass("wizardHidden");

        renderObsidianSetting(paneEl, "syncInternalFilesInterval", {
            clampMin: 10,
            acceptZero: true,
        }).setClass("wizardHidden");
    });
}
