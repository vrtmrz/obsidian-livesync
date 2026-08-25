import {
    type ObsidianLiveSyncSettings,
    LOG_LEVEL_NOTICE,
    REMOTE_COUCHDB,
    LEVEL_ADVANCED,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { Logger } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { $msg } from "@/common/translation";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
export function paneSyncSettings(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
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

            await this.saveAllDirtySettings();
            await this.services.control.applySettings();
            this.requestCatalogueRefresh();
        });
    });
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleSynchronizationMethod")).then((paneEl) => {
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

        new Setting(paneEl).autoWireDropDown("syncMode", {
            //@ts-ignore
            options: optionsSyncMode,
        });
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
            this.requestCatalogueRefresh();
        });

        new Setting(paneEl).autoWireNumeric("periodicReplicationInterval", {
            clampMax: 5000,
            onUpdate: onlyOnPeriodic,
        });

        new Setting(paneEl).autoWireNumeric("syncMinimumInterval", {
            onUpdate: onlyOnNonLiveSync,
        });
        new Setting(paneEl).autoWireToggle("syncOnSave", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl).autoWireToggle("syncOnEditorSave", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl).autoWireToggle("syncOnFileOpen", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl).autoWireToggle("syncOnStart", { onUpdate: onlyOnNonLiveSync });
        new Setting(paneEl).autoWireToggle("syncAfterMerge", { onUpdate: onlyOnNonLiveSync });
        for (const key of [
            "syncOnSave",
            "syncOnEditorSave",
            "syncOnFileOpen",
            "syncOnStart",
            "syncAfterMerge",
        ] as const) {
            this.addOnSaved(key, () => this.requestCatalogueRefresh());
        }
        // Desktop app only, and only for the sync modes that keep a background replication channel
        // (LiveSync and Periodic). Ignored on mobile, where suspending preserves battery. The
        // visibility predicate mirrors the runtime guard in ModuleObsidianEvents.
        if (!this.services.API.isMobile()) {
            new Setting(paneEl).autoWireToggle("keepReplicationActiveInBackground", {
                onUpdate: visibleOnly(
                    () => this.isConfiguredAs("syncMode", "LIVESYNC") || this.isConfiguredAs("syncMode", "PERIODIC")
                ),
            });
        }
        new Setting(paneEl).autoWireToggle("allowSleepDuringSynchronisation");
        if (!this.services.API.isMobile()) {
            new Setting(paneEl).autoWireToggle("allowSleepDuringSynchronisationOnDesktop");
        }
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleUpdateThinning"),
        undefined,
        visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"))
    ).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("batchSave");
        new Setting(paneEl).autoWireNumeric("batchSaveMinimumDelay", {
            acceptZero: true,
            onUpdate: visibleOnly(() => this.isConfiguredAs("batchSave", true)),
        });
        new Setting(paneEl).autoWireNumeric("batchSaveMaximumDelay", {
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
        new Setting(paneEl).autoWireToggle("doNotDeleteFolder");
    });
    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleConflictResolution"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("resolveConflictsByNewerFile");

        new Setting(paneEl).autoWireToggle("checkConflictOnlyOnOpen");

        new Setting(paneEl).autoWireToggle("showMergeDialogOnlyOnActive");
    });

    void addPanel(
        paneEl,
        $msg("obsidianLiveSyncSettingTab.titleSyncSettingsViaMarkdown"),
        undefined,
        undefined,
        LEVEL_ADVANCED
    ).then((paneEl) => {
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
        const LABEL_ENABLED = $msg("obsidianLiveSyncSettingTab.labelEnabled");
        const LABEL_DISABLED = $msg("obsidianLiveSyncSettingTab.labelDisabled");

        const hiddenFileSyncSetting = new Setting(paneEl).setName(
            $msg("obsidianLiveSyncSettingTab.nameHiddenFileSynchronization")
        );
        const hiddenFileSyncSettingEl = hiddenFileSyncSetting.settingEl;
        const hiddenFileSyncSettingDiv = hiddenFileSyncSettingEl.createDiv("");
        hiddenFileSyncSettingDiv.innerText = this.editingSettings.syncInternalFiles ? LABEL_ENABLED : LABEL_DISABLED;
        if (this.editingSettings.syncInternalFiles) {
            new Setting(paneEl)
                .setName($msg("obsidianLiveSyncSettingTab.nameDisableHiddenFileSync"))
                .addButton((button) => {
                    button.setButtonText($msg("obsidianLiveSyncSettingTab.btnDisable")).onClick(async () => {
                        this.editingSettings.syncInternalFiles = false;
                        await this.saveAllDirtySettings();
                        this.requestPageRefresh();
                    });
                });
        } else {
            new Setting(paneEl)
                .setName($msg("obsidianLiveSyncSettingTab.nameEnableHiddenFileSync"))
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

        new Setting(paneEl).autoWireToggle("suppressNotifyHiddenFilesChange", {});
        new Setting(paneEl).autoWireToggle("syncInternalFilesBeforeReplication", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("watchInternalFileChanges", true)),
        });

        new Setting(paneEl).autoWireNumeric("syncInternalFilesInterval", {
            clampMin: 10,
            acceptZero: true,
        });
    });
}
