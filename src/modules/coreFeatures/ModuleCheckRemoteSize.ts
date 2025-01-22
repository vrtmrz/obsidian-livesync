import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { AbstractModule } from "../AbstractModule.ts";
import { sizeToHumanReadable } from "octagonal-wheels/number";
import type { ICoreModule } from "../ModuleTypes.ts";
import { $tf } from "src/lib/src/common/i18n.ts";

export class ModuleCheckRemoteSize extends AbstractModule implements ICoreModule {
    async $allScanStat(): Promise<boolean> {
        this._log($tf("moduleCheckRemoteSize.logCheckingStorageSizes"), LOG_LEVEL_VERBOSE);
        if (this.settings.notifyThresholdOfRemoteStorageSize < 0) {
            const message = $tf("moduleCheckRemoteSize.msgSetDBCapacity");
            const ANSWER_0 = $tf("moduleCheckRemoteSize.optionNoWarn");
            const ANSWER_800 = $tf("moduleCheckRemoteSize.option800MB");
            const ANSWER_2000 = $tf("moduleCheckRemoteSize.option2GB");
            const ASK_ME_NEXT_TIME = $tf("moduleCheckRemoteSize.optionAskMeLater");

            const ret = await this.core.confirm.askSelectStringDialogue(
                message,
                [ANSWER_0, ANSWER_800, ANSWER_2000, ASK_ME_NEXT_TIME],
                {
                    defaultAction: ASK_ME_NEXT_TIME,
                    title: $tf("moduleCheckRemoteSize.titleDatabaseSizeNotify"),
                    timeout: 40,
                }
            );
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
                        const message = $tf("moduleCheckRemoteSize.msgDatabaseGrowing", {
                            estimatedSize: sizeToHumanReadable(estimatedSize),
                            maxSize: sizeToHumanReadable(maxSize),
                        });
                        const newMax = ~~(estimatedSize / 1024 / 1024) + 100;
                        const ANSWER_ENLARGE_LIMIT = $tf("moduleCheckRemoteSize.optionIncreaseLimit", {
                            newMax: newMax.toString(),
                        });
                        const ANSWER_REBUILD = $tf("moduleCheckRemoteSize.optionRebuildAll");
                        const ANSWER_IGNORE = $tf("moduleCheckRemoteSize.optionDismiss");
                        const ret = await this.core.confirm.askSelectStringDialogue(
                            message,
                            [ANSWER_ENLARGE_LIMIT, ANSWER_REBUILD, ANSWER_IGNORE],
                            {
                                defaultAction: ANSWER_IGNORE,
                                title: $tf("moduleCheckRemoteSize.titleDatabaseSizeLimitExceeded"),
                                timeout: 60,
                            }
                        );
                        if (ret == ANSWER_REBUILD) {
                            const ret = await this.core.confirm.askYesNoDialog(
                                $tf("moduleCheckRemoteSize.msgConfirmRebuild"),
                                { defaultOption: "No" }
                            );
                            if (ret == "yes") {
                                this.core.settings.notifyThresholdOfRemoteStorageSize = -1;
                                await this.saveSettings();
                                await this.core.rebuilder.scheduleRebuild();
                            }
                        } else if (ret == ANSWER_ENLARGE_LIMIT) {
                            this.settings.notifyThresholdOfRemoteStorageSize = ~~(estimatedSize / 1024 / 1024) + 100;
                            this._log(
                                $tf("moduleCheckRemoteSize.logThresholdEnlarged", {
                                    size: this.settings.notifyThresholdOfRemoteStorageSize.toString(),
                                }),
                                LOG_LEVEL_NOTICE
                            );
                            await this.core.saveSettings();
                        } else {
                            // Dismiss or Close the dialog
                        }

                        this._log(
                            $tf("moduleCheckRemoteSize.logExceededWarning", {
                                measuredSize: sizeToHumanReadable(estimatedSize),
                                notifySize: sizeToHumanReadable(
                                    this.settings.notifyThresholdOfRemoteStorageSize * 1024 * 1024
                                ),
                            }),
                            LOG_LEVEL_INFO
                        );
                    } else {
                        this._log($tf("moduleCheckRemoteSize.logCurrentStorageSize", {
                            measuredSize: sizeToHumanReadable(estimatedSize),
                        }), LOG_LEVEL_INFO);
                    }
                }
            }
        }
        return true;
    }
}
