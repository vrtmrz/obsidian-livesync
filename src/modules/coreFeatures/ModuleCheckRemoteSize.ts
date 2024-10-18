import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractModule } from "../AbstractModule.ts";
import { sizeToHumanReadable } from "octagonal-wheels/number";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleCheckRemoteSize extends AbstractModule implements ICoreModule {
    async $allScanStat(): Promise<boolean> {
        this._log(`Checking storage sizes`, LOG_LEVEL_VERBOSE);
        if (this.settings.notifyThresholdOfRemoteStorageSize < 0) {
            const message = `We can set a maximum database capacity warning, **to take action before running out of space on the remote storage**.
Do you want to enable this?

> [!MORE]-
> - 0: Do not warn about storage size.
>   This is recommended if you have enough space on the remote storage especially you have self-hosted. And you can check the storage size and rebuild manually.
> - 800: Warn if the remote storage size exceeds 800MB.
>   This is recommended if you are using fly.io with 1GB limit or IBM Cloudant.
> - 2000: Warn if the remote storage size exceeds 2GB.

If we have reached the limit, we will be asked to enlarge the limit step by step.
`
            const ANSWER_0 = "No, never warn please";
            const ANSWER_800 = "800MB (Cloudant, fly.io)";
            const ANSWER_2000 = "2GB (Standard)";
            const ASK_ME_NEXT_TIME = "Ask me later";

            const ret = await this.core.confirm.askSelectStringDialogue(message, [ANSWER_0, ANSWER_800, ANSWER_2000, ASK_ME_NEXT_TIME], {
                defaultAction: ASK_ME_NEXT_TIME,
                title: "Setting up database size notification", timeout: 40
            });
            if (ret == ANSWER_0) {
                this.settings.notifyThresholdOfRemoteStorageSize = 0;
                await this.core.saveSettings();
            } else if (ret == ANSWER_800) {
                this.settings.notifyThresholdOfRemoteStorageSize = 800;
                await this.core.saveSettings();
            } else if (ret == ANSWER_2000) {
                this.settings.notifyThresholdOfRemoteStorageSize = 2000;
                await this.core.saveSettings();
            }
        }
        if (this.settings.notifyThresholdOfRemoteStorageSize > 0) {
            const remoteStat = await this.core.replicator?.getRemoteStatus(this.settings);
            if (remoteStat) {
                const estimatedSize = remoteStat.estimatedSize;
                if (estimatedSize) {
                    const maxSize = this.settings.notifyThresholdOfRemoteStorageSize * 1024 * 1024;
                    if (estimatedSize > maxSize) {
                        const message = `**Your database is getting larger!** But do not worry, we can address it now. The time before running out of space on the remote storage.

| Measured size | Configured size |
| --- | --- |
| ${sizeToHumanReadable(estimatedSize)} | ${sizeToHumanReadable(maxSize)} |

> [!MORE]-
> If you have been using it for many years, there may be unreferenced chunks - that is, garbage - accumulating in the database. Therefore, we recommend rebuilding everything. It will probably become much smaller.
> 
> If the volume of your vault is simply increasing, it is better to rebuild everything after organizing the files. Self-hosted LiveSync does not delete the actual data even if you delete it to speed up the process. It is roughly [documented](https://github.com/vrtmrz/obsidian-livesync/blob/main/docs/tech_info.md).
> 
> If you don't mind the increase, you can increase the notification limit by 100MB. This is the case if you are running it on your own server. However, it is better to rebuild everything from time to time.
> 

> [!WARNING]
> If you perform rebuild everything, make sure all devices are synchronised. The plug-in will merge as much as possible, though.

\n`;
                        const newMax = ~~(estimatedSize / 1024 / 1024) + 100;
                        const ANSWER_ENLARGE_LIMIT = `increase to ${newMax}MB`;
                        const ANSWER_REBUILD = "Rebuild Everything Now";
                        const ANSWER_IGNORE = "Dismiss";
                        const ret = await this.core.confirm.askSelectStringDialogue(message, [ANSWER_ENLARGE_LIMIT, ANSWER_REBUILD, ANSWER_IGNORE,], {
                            defaultAction: ANSWER_IGNORE,
                            title: "Remote storage size exceeded the limit", timeout: 60

                        });
                        if (ret == ANSWER_REBUILD) {
                            const ret = await this.core.confirm.askYesNoDialog("This may take a bit of a long time. Do you really want to rebuild everything now?", { defaultOption: "No" });
                            if (ret == "yes") {
                                this.core.settings.notifyThresholdOfRemoteStorageSize = -1;
                                await this.saveSettings();
                                await this.core.rebuilder.scheduleRebuild();
                            }
                        } else if (ret == ANSWER_ENLARGE_LIMIT) {
                            this.settings.notifyThresholdOfRemoteStorageSize = ~~(estimatedSize / 1024 / 1024) + 100;
                            this._log(`Threshold has been enlarged to ${this.settings.notifyThresholdOfRemoteStorageSize}MB`, LOG_LEVEL_NOTICE);
                            await this.core.saveSettings();
                        } else {
                            // Dismiss or Close the dialog
                        }

                        this._log(`Remote storage size: ${sizeToHumanReadable(estimatedSize)} exceeded ${sizeToHumanReadable(this.settings.notifyThresholdOfRemoteStorageSize * 1024 * 1024)} `, LOG_LEVEL_INFO);
                    } else {
                        this._log(`Remote storage size: ${sizeToHumanReadable(estimatedSize)}`, LOG_LEVEL_INFO);
                    }
                }
            }
        }
        return true;
    }

}