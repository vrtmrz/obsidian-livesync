import { $msg } from "@/lib/src/common/i18n";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { type PageFunctions } from "./SettingPane";
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

        // Periodic Sync Interval

        // Sync Cooldown

        // Sync on Global Save

        // Sync on Save

        // Sync on Open

        // Sync on Startup

        // Sync After Merge
    });

    // Deletion Behaviour
    void addPanel(pageEl, $msg("sync.deletionBehaviour.title")).then((pageEl) => {

    });

    // Conflict Resolution
    void addPanel(pageEl, $msg("sync.conflictResolution.title")).then((pageEl) => {

    });

    // Custom Sync
    void addPanel(pageEl, $msg("sync.customSync.title")).then((pageEl) => {

    });

    // Hidden Files
    void addPanel(pageEl, $msg("sync.hiddenFiles.title")).then((pageEl) => {

    });
};