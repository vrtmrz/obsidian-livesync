import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractModule } from "../AbstractModule.ts";
import { sizeToHumanReadable } from "octagonal-wheels/number";
import { delay } from "octagonal-wheels/promises";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleCheckRemoteSize extends AbstractModule implements ICoreModule {
    async $allScanStat(): Promise<boolean> {
        this._log(`Checking storage sizes`, LOG_LEVEL_VERBOSE);
        if (this.settings.notifyThresholdOfRemoteStorageSize < 0) {
            const message = `Now, Self-hosted LiveSync is able to check the remote storage size on the start-up.

You can configure the threshold size for your remote storage. This will be different for your server.

Please choose the threshold size as you like.

- 0: Do not warn about storage size.
  This is recommended if you have enough space on the remote storage especially you have self-hosted. And you can check the storage size and rebuild manually.
- 800: Warn if the remote storage size exceeds 800MB.
  This is recommended if you are using fly.io with 1GB limit or IBM Cloudant.
- 2000: Warn if the remote storage size exceeds 2GB.

And if your actual storage size exceeds the threshold after the setup, you may warned again. But do not worry, you can enlarge the threshold (or rebuild everything to reduce the size).
`
            const ANSWER_0 = "Do not warn";
            const ANSWER_800 = "800MB";
            const ANSWER_2000 = "2GB";

            const ret = await this.core.confirm.confirmWithMessage("Remote storage size threshold", message, [ANSWER_0, ANSWER_800, ANSWER_2000], ANSWER_800, 40);
            if (ret == ANSWER_0) {
                this.settings.notifyThresholdOfRemoteStorageSize = 0;
                await this.core.saveSettings();
            } else if (ret == ANSWER_800) {
                this.settings.notifyThresholdOfRemoteStorageSize = 800;
                await this.core.saveSettings();
            } else {
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
                        const message = `Remote storage size: ${sizeToHumanReadable(estimatedSize)}. It exceeds the configured value ${sizeToHumanReadable(maxSize)}.
This may cause the storage to be full. You should enlarge the remote storage, or rebuild everything to reduce the size. \n
**Note:** If you are new to Self-hosted LiveSync, you should enlarge the threshold. \n

Self-hosted LiveSync will not release the storage automatically even if the file is deleted. This is why they need regular maintenance.\n

If you have enough space on the remote storage, you can enlarge the threshold. Otherwise, you should rebuild everything.\n

However, **Please make sure that all devices have been synchronised**. \n
\n`;
                        const newMax = ~~(estimatedSize / 1024 / 1024) + 100;
                        const ANSWER_ENLARGE_LIMIT = `Enlarge to ${newMax}MB`;
                        const ANSWER_REBUILD = "Rebuild now";
                        const ANSWER_IGNORE = "Dismiss";
                        const ret = await this.core.confirm.confirmWithMessage("Remote storage size exceeded", message, [ANSWER_ENLARGE_LIMIT, ANSWER_REBUILD, ANSWER_IGNORE,], ANSWER_IGNORE, 20);
                        if (ret == ANSWER_REBUILD) {
                            const ret = await this.core.confirm.askYesNoDialog("This may take a bit of a long time. Do you really want to rebuild everything now?", { defaultOption: "No" });
                            if (ret == "yes") {
                                this._log(`Receiving all from the server before rebuilding`, LOG_LEVEL_NOTICE);
                                await this.core.$$replicateAllFromServer(true);
                                await delay(3000);
                                this._log(`Obsidian will be reloaded to rebuild everything.`, LOG_LEVEL_NOTICE);
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