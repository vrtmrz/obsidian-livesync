import { EVENT_REQUEST_PERFORM_GC_V3, eventHub } from "@/common/events.ts";
import { $msg } from "../../../lib/src/common/i18n.ts";
import { LOG_LEVEL_NOTICE, Logger } from "../../../lib/src/common/logger.ts";
import { FlagFilesHumanReadable, FLAGMD_REDFLAG } from "../../../lib/src/common/types.ts";
import { fireAndForget } from "../../../lib/src/common/utils.ts";
import { LiveSyncCouchDBReplicator } from "../../../lib/src/replication/couchdb/LiveSyncReplicator.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { addSignalWord, visibleOnly, type PageFunctions } from "./SettingPane";
export function paneMaintenance(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    const isRemoteLockedAndDeviceNotAccepted = () => this.core?.replicator?.remoteLockedAndDeviceNotAccepted;
    const isRemoteLocked = () => this.core?.replicator?.remoteLocked;
    // if (this.plugin?.replicator?.remoteLockedAndDeviceNotAccepted) {
    this.createEl(
        paneEl,
        "div",
        {
            text: $msg("Ui.Settings.Maintenance.WarningLockedResolveText"),
        },
        (c) => {
            addSignalWord(c, "warning");
            this.createEl(
                c,
                "button",
                {
                    text: $msg("Ui.Settings.Maintenance.WarningLockedResolveAction"),
                    cls: "mod-warning",
                },
                (e) => {
                    e.addEventListener("click", () => {
                        fireAndForget(async () => {
                            await this.services.replication.markResolved();
                            this.display();
                        });
                    });
                }
            );
        },
        visibleOnly(isRemoteLockedAndDeviceNotAccepted)
    );
    this.createEl(
        paneEl,
        "div",
        {
            text: $msg("Ui.Settings.Maintenance.WarningLockedReadyText"),
        },
        (c) => {
            addSignalWord(c, "warning");
            this.createEl(
                c,
                "button",
                {
                    text: $msg("Ui.Settings.Maintenance.WarningLockedReadyAction"),
                    cls: "mod-warning",
                },
                (e) => {
                    e.addEventListener("click", () => {
                        fireAndForget(async () => {
                            await this.services.replication.markUnlocked();
                            this.display();
                        });
                    });
                }
            );
        },
        visibleOnly(isRemoteLocked)
    );

    void addPanel(paneEl, $msg("Ui.Settings.Maintenance.Scram")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.LockServer"))
            .setDesc($msg("Ui.Settings.Maintenance.LockServerDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Common.Lock"))
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        await this.services.replication.markLocked();
                    })
            )
            .addOnUpdate(this.onlyOnCouchDBOrMinIO);

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.EmergencyRestart"))
            .setDesc($msg("Ui.Settings.Maintenance.EmergencyRestartDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Maintenance.WriteRedFlagAndRestart"))
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        await this.core.storageAccess.writeFileAuto(FLAGMD_REDFLAG, "");
                        this.services.appLifecycle.performRestart();
                    })
            );
    });

    void addPanel(paneEl, $msg("Ui.Settings.Maintenance.ResetLocalSyncInfo")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.ResetThisDevice"))
            .setDesc($msg("Ui.Settings.Maintenance.ResetLocalSyncInfoDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Maintenance.ScheduleAndRestart"))
                    .setCta()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.core.storageAccess.writeFileAuto(FlagFilesHumanReadable.FETCH_ALL, "");
                        this.services.appLifecycle.performRestart();
                    })
            );
        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.OverwriteServerData"))
            .setDesc($msg("Ui.Settings.Maintenance.OverwriteServerDataDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Maintenance.ScheduleAndRestart"))
                    .setCta()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.core.storageAccess.writeFileAuto(FlagFilesHumanReadable.REBUILD_ALL, "");
                        this.services.appLifecycle.performRestart();
                    })
            );
    });

    void addPanel(paneEl, $msg("Ui.Settings.Maintenance.Syncing"), () => {}, this.onlyOnCouchDBOrMinIO).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.Resend"))
            .setDesc($msg("Ui.Settings.Maintenance.ResendDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Maintenance.SendChunks"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        if (this.core.replicator instanceof LiveSyncCouchDBReplicator) {
                            await this.core.replicator.sendChunks(this.core.settings, undefined, true, 0);
                        }
                    })
            )
            .addOnUpdate(this.onlyOnCouchDB);

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.ResetJournalReceived"))
            .setDesc($msg("Ui.Settings.Maintenance.ResetJournalReceivedDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Maintenance.ResetReceived"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            receivedFiles: new Set(),
                            knownIDs: new Set(),
                        }));
                        Logger(`Journal received history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.ResetJournalSent"))
            .setDesc($msg("Ui.Settings.Maintenance.ResetJournalSentDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Maintenance.ResetSentHistory"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            lastLocalSeq: 0,
                            sentIDs: new Set(),
                            sentFiles: new Set(),
                        }));
                        Logger(`Journal sent history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);
    });
    void addPanel(
        paneEl,
        $msg("Ui.Settings.Maintenance.GarbageCollection"),
        (e) => e,
        this.onlyOnP2POrCouchDB
    ).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.GarbageCollectionAction"))
            .setDesc($msg("Ui.Settings.Maintenance.GarbageCollectionDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Maintenance.GarbageCollectionAction"))
                    .setDisabled(false)
                    .onClick(() => {
                        this.closeSetting();
                        eventHub.emitEvent(EVENT_REQUEST_PERFORM_GC_V3);
                    })
            );
    });
    // void addPanel(paneEl, "Garbage Collection (Beta2)", (e) => e, this.onlyOnP2POrCouchDB).then((paneEl) => {
    //     new Setting(paneEl)
    //         .setName("Scan garbage")
    //         .setDesc("Scan for garbage chunks in the database.")
    //         .addButton((button) =>
    //             button
    //                 .setButtonText("Scan")
    //                 // .setWarning()
    //                 .setDisabled(false)
    //                 .onClick(async () => {
    //                     await this.plugin
    //                         .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                         ?.trackChanges(false, true);
    //                 })
    //         )
    //         .addButton((button) =>
    //             button.setButtonText("Rescan").onClick(async () => {
    //                 await this.plugin
    //                     .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                     ?.trackChanges(true, true);
    //             })
    //         );
    //     new Setting(paneEl)
    //         .setName("Collect garbage")
    //         .setDesc("Remove all unused chunks from the local database.")
    //         .addButton((button) =>
    //             button
    //                 .setButtonText("Collect")
    //                 .setWarning()
    //                 .setDisabled(false)
    //                 .onClick(async () => {
    //                     await this.plugin
    //                         .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                         ?.performGC(true);
    //                 })
    //         );
    //     new Setting(paneEl)
    //         .setName("Commit File Deletion")
    //         .setDesc("Completely delete all deleted documents from the local database.")
    //         .addButton((button) =>
    //             button
    //                 .setButtonText("Delete")
    //                 .setWarning()
    //                 .setDisabled(false)
    //                 .onClick(async () => {
    //                     await this.plugin
    //                         .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                         ?.commitFileDeletion();
    //                 })
    //         );
    // });
    // void addPanel(paneEl, "Garbage Collection (Old and Experimental)", (e) => e, this.onlyOnP2POrCouchDB).then(
    //     (paneEl) => {
    //         new Setting(paneEl)
    //             .setName("Remove all orphaned chunks")
    //             .setDesc("Remove all orphaned chunks from the local database.")
    //             .addButton((button) =>
    //                 button
    //                     .setButtonText("Remove")
    //                     .setWarning()
    //                     .setDisabled(false)
    //                     .onClick(async () => {
    //                         await this.plugin
    //                             .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                             ?.removeUnusedChunks();
    //                     })
    //             );

    //         new Setting(paneEl)
    //             .setName("Resurrect deleted chunks")
    //             .setDesc(
    //                 "If you have deleted chunks before fully synchronised and missed some chunks, you possibly can resurrect them."
    //             )
    //             .addButton((button) =>
    //                 button
    //                     .setButtonText("Try resurrect")
    //                     .setWarning()
    //                     .setDisabled(false)
    //                     .onClick(async () => {
    //                         await this.plugin
    //                             .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
    //                             ?.resurrectChunks();
    //                     })
    //             );
    //     }
    // );

    void addPanel(
        paneEl,
        $msg("Ui.Settings.Maintenance.RebuildingOperations"),
        () => {},
        this.onlyOnCouchDBOrMinIO
    ).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.Cleanup"))
            .setDesc($msg("Ui.Settings.Maintenance.CleanupDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Common.Perform"))
                    .setDisabled(false)
                    .onClick(async () => {
                        const replicator = this.core.replicator as LiveSyncCouchDBReplicator;
                        Logger(`Cleanup has been began`, LOG_LEVEL_NOTICE, "compaction");
                        if (await replicator.compactRemote(this.editingSettings)) {
                            Logger(`Cleanup has been completed!`, LOG_LEVEL_NOTICE, "compaction");
                        } else {
                            Logger(`Cleanup has been failed!`, LOG_LEVEL_NOTICE, "compaction");
                        }
                    })
            )
            .addOnUpdate(this.onlyOnCouchDB);

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.OverwriteRemote"))
            .setDesc($msg("Ui.Settings.Maintenance.OverwriteRemoteDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Common.Send"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.rebuildDB("remoteOnly");
                    })
            );

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.ResetAllJournalCounter"))
            .setDesc($msg("Ui.Settings.Maintenance.ResetAllJournalCounterDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Common.ResetAll"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().resetCheckpointInfo();
                        Logger(`Journal exchange history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.PurgeAllJournalCounter"))
            .setDesc($msg("Ui.Settings.Maintenance.PurgeAllJournalCounterDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Common.ResetAll"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().resetAllCaches();
                        Logger(`Journal download/upload cache has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.FreshStartWipe"))
            .setDesc($msg("Ui.Settings.Maintenance.FreshStartWipeDesc"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Common.Delete"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().updateCheckPointInfo((info) => ({
                            ...info,
                            receivedFiles: new Set(),
                            knownIDs: new Set(),
                            lastLocalSeq: 0,
                            sentIDs: new Set(),
                            sentFiles: new Set(),
                        }));
                        await this.resetRemoteBucket();
                        Logger(`Deleted all data on remote server`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);
    });

    void addPanel(paneEl, $msg("Ui.Settings.Maintenance.Reset")).then((paneEl) => {
        new Setting(paneEl)
            .setName($msg("Ui.Settings.Maintenance.DeleteLocalDatabase"))
            .addButton((button) =>
                button
                    .setButtonText($msg("Ui.Settings.Common.Delete"))
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.services.database.resetDatabase();
                        await this.services.databaseEvents.initialiseDatabase();
                    })
            );
    });
}
