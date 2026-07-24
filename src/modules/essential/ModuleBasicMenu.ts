import type { LiveSyncCore } from "@/main";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { fireAndForget } from "octagonal-wheels/promises";
import { AbstractModule } from "@/modules/AbstractModule";
import { $msg } from "@/common/translation";
import { copyFileDatabaseInfo } from "@/serviceFeatures/fileDatabaseInfo";
// Separated Module for basic menu commands, which are not related to obsidian specific features. It is expected to be used in other platforms with minimal changes.
// However, it is odd that it has here at all; it really ought to be in each respective feature. It will likely be moved eventually. Until now, addCommand pointed to Obsidian's version.
export class ModuleBasicMenu extends AbstractModule {
    _everyOnloadStart(): Promise<boolean> {
        this.addCommand({
            id: "livesync-replicate",
            name: $msg("Sync now"),
            callback: async () => {
                await this.services.replication.replicate();
            },
        });
        this.addCommand({
            id: "livesync-dump",
            name: $msg("Copy database information for the active file"),
            checkCallback: (checking) => {
                const file = this.services.vault.getActiveFilePath();
                if (!file) return false;
                if (!checking) {
                    fireAndForget(() => copyFileDatabaseInfo(this.core, file));
                }
                return true;
            },
        });
        this.addCommand({
            id: "livesync-toggle",
            name: "Toggle LiveSync",
            callback: async () => {
                if (this.settings.liveSync) {
                    this.settings.liveSync = false;
                    this._log("LiveSync Disabled.", LOG_LEVEL_NOTICE);
                } else {
                    this.settings.liveSync = true;
                    this._log("LiveSync Enabled.", LOG_LEVEL_NOTICE);
                }
                await this.services.control.applySettings();
                await this.services.setting.saveSettingData();
            },
        });
        this.addCommand({
            id: "livesync-suspendall",
            name: "Toggle All Sync.",
            callback: async () => {
                if (this.services.appLifecycle.isSuspended()) {
                    this.services.appLifecycle.setSuspended(false);
                    this._log("Self-hosted LiveSync resumed", LOG_LEVEL_NOTICE);
                } else {
                    this.services.appLifecycle.setSuspended(true);
                    this._log("Self-hosted LiveSync suspended", LOG_LEVEL_NOTICE);
                }
                await this.services.control.applySettings();
                await this.services.setting.saveSettingData();
            },
        });

        this.addCommand({
            id: "livesync-scan-files",
            name: "Scan storage and database again",
            checkCallback: (checking) => {
                if (!this.settings.useAdvancedMode) return false;
                if (!checking) {
                    fireAndForget(() => this.services.vault.scanVault(true));
                }
                return true;
            },
        });

        this.addCommand({
            id: "livesync-runbatch",
            name: $msg("Apply pending changes now"),
            callback: async () => {
                await this.services.fileProcessing.commitPendingFileEvents();
            },
        });

        // TODO, Replicator is possibly one of features. It should be moved to features.
        this.addCommand({
            id: "livesync-abortsync",
            name: "Abort synchronization immediately",
            checkCallback: (checking) => {
                if (!this.settings.useAdvancedMode) return false;
                if (!checking) {
                    this.core.replicator.terminateSync();
                }
                return true;
            },
        });
        return Promise.resolve(true);
    }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.appLifecycle.onInitialise.addHandler(this._everyOnloadStart.bind(this));
    }
}
