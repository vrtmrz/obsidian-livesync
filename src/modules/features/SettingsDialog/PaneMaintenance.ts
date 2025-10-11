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

    void addPanel(paneEl, "Rebuilding Operations (Remote Only)", () => { }, this.onlyOnCouchDBOrMinIO).then((paneEl) => {

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
}
