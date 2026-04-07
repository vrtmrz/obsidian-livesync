import { $msg } from "@/lib/src/common/i18n";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { visibleOnly, type PageFunctions } from "./SettingPane";
import { LOG_LEVEL_NOTICE, REMOTE_COUCHDB, type ObsidianLiveSyncSettings } from "@/lib/src/common/types";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting";
import { EVENT_REQUEST_COPY_SETUP_URI, eventHub } from "@/common/events";
import { Logger } from "@/lib/src/common/logger";

export function pageSync(
    this: ObsidianLiveSyncSettingTab,
    pageEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    // Basic Sync
    void addPanel(pageEl, $msg("sync.basicSync.title")).then((pageEl) => {
        const onlyOnNonLiveSync = visibleOnly(() => !this.isConfiguredAs("syncMode", "LIVESYNC"));
        const onlyOnPeriodic = visibleOnly(() => this.isConfiguredAs("syncMode", "PERIODIC"));

        // Sync Presets
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

        new Setting(pageEl)
            .autoWireDropDown("preset", {
                options: options,
                holdValue: true,
            })
            .setName($msg("sync.basicSync.syncPresets.title"))
            .setDesc($msg("sync.basicSync.syncPresets.desc"))
            .addButton((button) => {
                button.setButtonText($msg("action.button.apply"));
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

        // Sync Mode
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

        new Setting(pageEl)
            .autoWireDropDown("syncMode", {
                //@ts-ignore
                options: optionsSyncMode,
            })
            .setName($msg("sync.basicSync.syncMode.title"))
            .setDesc($msg("sync.basicSync.syncMode.desc"))
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

            await this.plugin.$$realizeSettingSyncMode();
        });

        // Periodic Sync Interval
        new Setting(pageEl)
            .autoWireNumeric("periodicReplicationInterval", {
                clampMax: 5000,
                onUpdate: onlyOnPeriodic,
            })
            .setName($msg("sync.basicSync.periodicSyncInterval.title"))
            .setDesc($msg("sync.basicSync.periodicSyncInterval.desc"))
            .setClass("wizardHidden");

        // Sync Cooldown
        new Setting(pageEl).autoWireNumeric("syncMinimumInterval", {
            onUpdate: onlyOnNonLiveSync,
        })
            .setName($msg("sync.basicSync.syncCooldown.title"))
            .setDesc($msg("sync.basicSync.syncCooldown.desc"));

        // Sync on Global Save
        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("syncOnSave", { onUpdate: onlyOnNonLiveSync })
            .setName($msg("sync.basicSync.syncOnGlobalSave.title"))
            .setDesc($msg("sync.basicSync.syncOnGlobalSave.desc"));

        // Sync on Save
        new Setting(pageEl)
            .setClass("wizardHidden")
            .autoWireToggle("syncOnEditorSave", { onUpdate: onlyOnNonLiveSync })
            .setName($msg("sync.basicSync.syncOnSave.title"))
            .setDesc($msg("sync.basicSync.syncOnSave.desc"));

        // Sync on Open
        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("syncOnFileOpen", { onUpdate: onlyOnNonLiveSync })
            .setName($msg("sync.basicSync.syncOnOpen.title"))
            .setDesc($msg("sync.basicSync.syncOnOpen.desc"));

        // Sync on Startup
        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("syncOnStart", { onUpdate: onlyOnNonLiveSync })
            .setName($msg("sync.basicSync.syncOnStartup.title"))
            .setDesc($msg("sync.basicSync.syncOnStartup.desc"));

        // Sync After Merge
        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("syncAfterMerge", { onUpdate: onlyOnNonLiveSync })
            .setName($msg("sync.basicSync.syncAfterMerge.title"))
            .setDesc($msg("sync.basicSync.syncAfterMerge.desc"));
    });

    // Deletion Behaviour
    void addPanel(pageEl, $msg("sync.deletionBehaviour.title")).then((pageEl) => {
        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("trashInsteadDelete")
            .setName($msg("sync.deletionBehaviour.moveToTrash.title"))
            .setDesc($msg("sync.deletionBehaviour.moveToTrash.desc"));

        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("doNotDeleteFolder")
            .setName($msg("sync.deletionBehaviour.keepEmptyFolders.title"))
            .setDesc($msg("sync.deletionBehaviour.keepEmptyFolders.desc"));
    });

    // Conflict Resolution
    void addPanel(pageEl, $msg("sync.conflictResolution.title")).then((pageEl) => {
        pageEl.addClass("wizardHidden");

        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("resolveConflictsByNewerFile")
            .setName($msg("sync.conflictResolution.alwaysUseNewVersion.title"))
            .setDesc($msg("sync.conflictResolution.alwaysUseNewVersion.desc"));

        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("checkConflictOnlyOnOpen")
            .setName($msg("sync.conflictResolution.delayResolution.title"))
            .setDesc($msg("sync.conflictResolution.delayResolution.desc"));

        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("showMergeDialogOnlyOnActive")
            .setName($msg("sync.conflictResolution.delayPrompt.title"))
            .setDesc($msg("sync.conflictResolution.delayPrompt.desc"));
    });

    // Custom Sync
    void addPanel(pageEl, $msg("sync.customSync.title")).then((pageEl) => {

    });

    // Hidden Files
    void addPanel(pageEl, $msg("sync.hiddenFiles.title")).then((pageEl) => {
        pageEl.addClass("wizardHidden");
        const LABEL_ENABLED = $msg("obsidianLiveSyncSettingTab.labelEnabled");
        const LABEL_DISABLED = $msg("obsidianLiveSyncSettingTab.labelDisabled");

        const hiddenFileSyncSetting = new Setting(pageEl)
            .setName($msg("obsidianLiveSyncSettingTab.nameHiddenFileSynchronization"))
            .setClass("wizardHidden")
            // .setName($msg("sync.deletionBehaviour.moveToTrash.title"))
            // .setDesc($msg("sync.deletionBehaviour.moveToTrash.desc"));
        const hiddenFileSyncSettingEl = hiddenFileSyncSetting.settingEl;
        const hiddenFileSyncSettingDiv = hiddenFileSyncSettingEl.createDiv("");
        hiddenFileSyncSettingDiv.innerText = this.editingSettings.syncInternalFiles ? LABEL_ENABLED : LABEL_DISABLED;
        if (this.editingSettings.syncInternalFiles) {
            new Setting(pageEl)
                .setName($msg("obsidianLiveSyncSettingTab.nameDisableHiddenFileSync"))
                // .setDesc($msg("sync.deletionBehaviour.moveToTrash.desc"))
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText($msg("obsidianLiveSyncSettingTab.btnDisable")).onClick(async () => {
                        this.editingSettings.syncInternalFiles = false;
                        await this.saveAllDirtySettings();
                        this.display();
                    });
                });
        } else {
            new Setting(pageEl)
                .setName($msg("obsidianLiveSyncSettingTab.nameEnableHiddenFileSync"))
                // .setName($msg("sync.deletionBehaviour.moveToTrash.title"))
                // .setDesc($msg("sync.deletionBehaviour.moveToTrash.desc"))
                .setClass("wizardHidden")
                .addButton((button) => {
                    button.setButtonText("Merge").onClick(async () => {
                        this.closeSetting();
                        // this.resetEditingSettings();
                        await this.plugin.$anyConfigureOptionalSyncFeature("MERGE");
                    });
                })
                .addButton((button) => {
                    button.setButtonText("Fetch").onClick(async () => {
                        this.closeSetting();
                        // this.resetEditingSettings();
                        await this.plugin.$anyConfigureOptionalSyncFeature("FETCH");
                    });
                })
                .addButton((button) => {
                    button.setButtonText("Overwrite").onClick(async () => {
                        this.closeSetting();
                        // this.resetEditingSettings();
                        await this.plugin.$anyConfigureOptionalSyncFeature("OVERWRITE");
                    });
                });
        }

        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("suppressNotifyHiddenFilesChange", {})
            // .setName($msg("sync.deletionBehaviour.moveToTrash.title"))
            // .setDesc($msg("sync.deletionBehaviour.moveToTrash.desc"));
        new Setting(pageEl).setClass("wizardHidden").autoWireToggle("syncInternalFilesBeforeReplication", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("watchInternalFileChanges", true)),
        })
            // .setName($msg("sync.deletionBehaviour.moveToTrash.title"))
            // .setDesc($msg("sync.deletionBehaviour.moveToTrash.desc"));

        new Setting(pageEl).setClass("wizardHidden").autoWireNumeric("syncInternalFilesInterval", {
            clampMin: 10,
            acceptZero: true,
        })
            // .setName($msg("sync.deletionBehaviour.moveToTrash.title"))
            // .setDesc($msg("sync.deletionBehaviour.moveToTrash.desc"));
    });
};