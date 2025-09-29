import { LocalDatabaseMaintenance } from "../../../features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts";
import { LOG_LEVEL_NOTICE, Logger } from "../../../lib/src/common/logger.ts";
import { FLAGMD_REDFLAG, FLAGMD_REDFLAG2_HR, FLAGMD_REDFLAG3_HR } from "../../../lib/src/common/types.ts";
import { fireAndForget } from "../../../lib/src/common/utils.ts";
import { LiveSyncCouchDBReplicator } from "../../../lib/src/replication/couchdb/LiveSyncReplicator.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { visibleOnly, type PageFunctions } from "./SettingPane";
export function paneMaintenance(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    const isRemoteLockedAndDeviceNotAccepted = () => this.plugin?.replicator?.remoteLockedAndDeviceNotAccepted;
    const isRemoteLocked = () => this.plugin?.replicator?.remoteLocked;
    // if (this.plugin?.replicator?.remoteLockedAndDeviceNotAccepted) {
    this.createEl(
        paneEl,
        "div",
        {
            text: "The remote database is locked for synchronization to prevent vault corruption because this device isn't marked as 'resolved'. Please backup your vault, reset the local database, and select 'Mark this device as resolved'. This warning will persist until the device is confirmed as resolved by replication.",
            cls: "op-warn",
        },
        (c) => {
            this.createEl(
                c,
                "button",
                {
                    text: "I've made a backup, mark this device 'resolved'",
                    cls: "mod-warning",
                },
                (e) => {
                    e.addEventListener("click", () => {
                        fireAndForget(async () => {
                            await this.plugin.$$markRemoteResolved();
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
            text: "To prevent unwanted vault corruption, the remote database has been locked for synchronization. (This device is marked 'resolved') When all your devices are marked 'resolved', unlock the database. This warning kept showing until confirming the device is resolved by the replication",
            cls: "op-warn",
        },
        (c) =>
            this.createEl(
                c,
                "button",
                {
                    text: "I'm ready, unlock the database",
                    cls: "mod-warning",
                },
                (e) => {
                    e.addEventListener("click", () => {
                        fireAndForget(async () => {
                            await this.plugin.$$markRemoteUnlocked();
                            this.display();
                        });
                    });
                }
            ),
        visibleOnly(isRemoteLocked)
    );

    void addPanel(paneEl, "Scram!").then((paneEl) => {
        new Setting(paneEl)
            .setName("Lock Server")
            .setDesc("Lock the remote server to prevent synchronization with other devices.")
            .addButton((button) =>
                button
                    .setButtonText("Lock")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.$$markRemoteLocked();
                    })
            )
            .addOnUpdate(this.onlyOnCouchDBOrMinIO);

        new Setting(paneEl)
            .setName("Emergency restart")
            .setDesc("Disables all synchronization and restart.")
            .addButton((button) =>
                button
                    .setButtonText("Flag and restart")
                    .setDisabled(false)
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG, "");
                        this.plugin.$$performRestart();
                    })
            );
    });

    void addPanel(paneEl, "Syncing", () => { }, this.onlyOnCouchDBOrMinIO).then((paneEl) => {
        new Setting(paneEl)
            .setName("Resend")
            .setDesc("Resend all chunks to the remote.")
            .addButton((button) =>
                button
                    .setButtonText("Send chunks")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        if (this.plugin.replicator instanceof LiveSyncCouchDBReplicator) {
                            await this.plugin.replicator.sendChunks(this.plugin.settings, undefined, true, 0);
                        }
                    })
            )
            .addOnUpdate(this.onlyOnCouchDB);

        new Setting(paneEl)
            .setName("Reset journal received history")
            .setDesc(
                "Initialise journal received history. On the next sync, every item except this device sent will be downloaded again."
            )
            .addButton((button) =>
                button
                    .setButtonText("Reset received")
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
            .setName("Reset journal sent history")
            .setDesc(
                "Initialise journal sent history. On the next sync, every item except this device received will be sent again."
            )
            .addButton((button) =>
                button
                    .setButtonText("Reset sent history")
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
    void addPanel(paneEl, "Garbage Collection (Beta2)", (e) => e, this.onlyOnP2POrCouchDB).then((paneEl) => {
        new Setting(paneEl)
            .setName("Scan garbage")
            .setDesc("Scan for garbage chunks in the database.")
            .addButton((button) =>
                button
                    .setButtonText("Scan")
                    // .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin
                            .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
                            ?.trackChanges(false, true);
                    })
            )
            .addButton((button) =>
                button.setButtonText("Rescan").onClick(async () => {
                    await this.plugin
                        .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
                        ?.trackChanges(true, true);
                })
            );
        new Setting(paneEl)
            .setName("Collect garbage")
            .setDesc("Remove all unused chunks from the local database.")
            .addButton((button) =>
                button
                    .setButtonText("Collect")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin
                            .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
                            ?.performGC(true);
                    })
            );
        new Setting(paneEl)
            .setName("Commit File Deletion")
            .setDesc("Completely delete all deleted documents from the local database.")
            .addButton((button) =>
                button
                    .setButtonText("Delete")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin
                            .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
                            ?.commitFileDeletion();
                    })
            );
    });
    void addPanel(paneEl, "Garbage Collection (Old and Experimental)", (e) => e, this.onlyOnP2POrCouchDB).then(
        (paneEl) => {
            new Setting(paneEl)
                .setName("Remove all orphaned chunks")
                .setDesc("Remove all orphaned chunks from the local database.")
                .addButton((button) =>
                    button
                        .setButtonText("Remove")
                        .setWarning()
                        .setDisabled(false)
                        .onClick(async () => {
                            await this.plugin
                                .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
                                ?.removeUnusedChunks();
                        })
                );

            new Setting(paneEl)
                .setName("Resurrect deleted chunks")
                .setDesc(
                    "If you have deleted chunks before fully synchronised and missed some chunks, you possibly can resurrect them."
                )
                .addButton((button) =>
                    button
                        .setButtonText("Try resurrect")
                        .setWarning()
                        .setDisabled(false)
                        .onClick(async () => {
                            await this.plugin
                                .getAddOn<LocalDatabaseMaintenance>(LocalDatabaseMaintenance.name)
                                ?.resurrectChunks();
                        })
                );
        }
    );
    void addPanel(paneEl, "Rebuilding Operations (Local)").then((paneEl) => {
        new Setting(paneEl)
            .setName("Fetch from remote")
            .setDesc("Restore or reconstruct local database from remote.")
            .addButton((button) =>
                button
                    .setButtonText("Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG3_HR, "");
                        this.plugin.$$performRestart();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Fetch w/o restarting")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.rebuildDB("localOnly");
                    })
            );

        new Setting(paneEl)
            .setName("Fetch rebuilt DB (Save local documents before)")
            .setDesc("Restore or reconstruct local database from remote database but use local chunks.")
            .addButton((button) =>
                button
                    .setButtonText("Save and Fetch")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.rebuildDB("localOnlyWithChunks");
                    })
            )
            .addOnUpdate(this.onlyOnCouchDB);
    });

    void addPanel(paneEl, "Total Overhaul", () => { }, this.onlyOnCouchDBOrMinIO).then((paneEl) => {
        new Setting(paneEl)
            .setName("Rebuild everything")
            .setDesc("Rebuild local and remote database with local files.")
            .addButton((button) =>
                button
                    .setButtonText("Rebuild")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.storageAccess.writeFileAuto(FLAGMD_REDFLAG2_HR, "");
                        this.plugin.$$performRestart();
                    })
            )
            .addButton((button) =>
                button
                    .setButtonText("Rebuild w/o restarting")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.rebuildDB("rebuildBothByThisDevice");
                    })
            );
    });
    void addPanel(paneEl, "Rebuilding Operations (Remote Only)", () => { }, this.onlyOnCouchDBOrMinIO).then((paneEl) => {
        new Setting(paneEl)
            .setName("Perform cleanup")
            .setDesc(
                "Reduces storage space by discarding all non-latest revisions. This requires the same amount of free space on the remote server and the local client."
            )
            .addButton((button) =>
                button
                    .setButtonText("Perform")
                    .setDisabled(false)
                    .onClick(async () => {
                        const replicator = this.plugin.replicator as LiveSyncCouchDBReplicator;
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
            .setName("Overwrite remote")
            .setDesc("Overwrite remote with local DB and passphrase.")
            .addButton((button) =>
                button
                    .setButtonText("Send")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.rebuildDB("remoteOnly");
                    })
            );

        new Setting(paneEl)
            .setName("Reset all journal counter")
            .setDesc("Initialise all journal history, On the next sync, every item will be received and sent.")
            .addButton((button) =>
                button
                    .setButtonText("Reset all")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().resetCheckpointInfo();
                        Logger(`Journal exchange history has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName("Purge all journal counter")
            .setDesc("Purge all download/upload cache.")
            .addButton((button) =>
                button
                    .setButtonText("Reset all")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.getMinioJournalSyncClient().resetAllCaches();
                        Logger(`Journal download/upload cache has been cleared.`, LOG_LEVEL_NOTICE);
                    })
            )
            .addOnUpdate(this.onlyOnMinIO);

        new Setting(paneEl)
            .setName("Fresh Start Wipe")
            .setDesc("Delete all data on the remote server.")
            .addButton((button) =>
                button
                    .setButtonText("Delete")
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

    void addPanel(paneEl, "Reset").then((paneEl) => {
        new Setting(paneEl)
            .setName("Delete local database to reset or uninstall Self-hosted LiveSync")
            .addButton((button) =>
                button
                    .setButtonText("Delete")
                    .setWarning()
                    .setDisabled(false)
                    .onClick(async () => {
                        await this.plugin.$$resetLocalDatabase();
                        await this.plugin.$$initializeDatabase();
                    })
            );
    });
}
