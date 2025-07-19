import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { normalizePath } from "../../deps.ts";
import {
    FLAGMD_REDFLAG,
    FLAGMD_REDFLAG2,
    FLAGMD_REDFLAG2_HR,
    FLAGMD_REDFLAG3,
    FLAGMD_REDFLAG3_HR,
    type ObsidianLiveSyncSettings,
} from "../../lib/src/common/types.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";
import { $msg } from "../../lib/src/common/i18n.ts";

export class ModuleRedFlag extends AbstractModule implements ICoreModule {
    async isFlagFileExist(path: string) {
        const redflag = await this.core.storageAccess.isExists(normalizePath(path));
        if (redflag) {
            return true;
        }
        return false;
    }

    async deleteFlagFile(path: string) {
        try {
            const isFlagged = await this.core.storageAccess.isExists(normalizePath(path));
            if (isFlagged) {
                await this.core.storageAccess.delete(path, true);
            }
        } catch (ex) {
            this._log(`Could not delete ${path}`);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
    }

    isRedFlagRaised = async () => await this.isFlagFileExist(FLAGMD_REDFLAG);
    isRedFlag2Raised = async () =>
        (await this.isFlagFileExist(FLAGMD_REDFLAG2)) || (await this.isFlagFileExist(FLAGMD_REDFLAG2_HR));
    isRedFlag3Raised = async () =>
        (await this.isFlagFileExist(FLAGMD_REDFLAG3)) || (await this.isFlagFileExist(FLAGMD_REDFLAG3_HR));

    async deleteRedFlag2() {
        await this.deleteFlagFile(FLAGMD_REDFLAG2);
        await this.deleteFlagFile(FLAGMD_REDFLAG2_HR);
    }

    async deleteRedFlag3() {
        await this.deleteFlagFile(FLAGMD_REDFLAG3);
        await this.deleteFlagFile(FLAGMD_REDFLAG3_HR);
    }
    async $everyOnLayoutReady(): Promise<boolean> {
        try {
            const isRedFlagRaised = await this.isRedFlagRaised();
            const isRedFlag2Raised = await this.isRedFlag2Raised();
            const isRedFlag3Raised = await this.isRedFlag3Raised();

            if (isRedFlagRaised || isRedFlag2Raised || isRedFlag3Raised) {
                if (isRedFlag2Raised) {
                    if (
                        (await this.core.confirm.askYesNoDialog(
                            "Rebuild everything has been scheduled! Are you sure to rebuild everything?",
                            { defaultOption: "Yes", timeout: 0 }
                        )) !== "yes"
                    ) {
                        await this.deleteRedFlag2();
                        await this.core.$$performRestart();
                        return false;
                    }
                }
                if (isRedFlag3Raised) {
                    if (
                        (await this.core.confirm.askYesNoDialog("Fetch again has been scheduled! Are you sure?", {
                            defaultOption: "Yes",
                            timeout: 0,
                        })) !== "yes"
                    ) {
                        await this.deleteRedFlag3();
                        await this.core.$$performRestart();
                        return false;
                    }
                }
                this.settings.batchSave = false;
                await this.core.$allSuspendAllSync();
                await this.core.$allSuspendExtraSync();
                this.settings.suspendFileWatching = true;
                await this.saveSettings();
                if (isRedFlag2Raised) {
                    this._log(
                        `${FLAGMD_REDFLAG2} or ${FLAGMD_REDFLAG2_HR} has been detected! Self-hosted LiveSync suspends all sync and rebuild everything.`,
                        LOG_LEVEL_NOTICE
                    );
                    await this.core.rebuilder.$rebuildEverything();
                    await this.deleteRedFlag2();
                    if (
                        (await this.core.confirm.askYesNoDialog(
                            "Do you want to resume file and database processing, and restart obsidian now?",
                            { defaultOption: "Yes", timeout: 15 }
                        )) == "yes"
                    ) {
                        this.settings.suspendFileWatching = false;
                        await this.saveSettings();
                        this.core.$$performRestart();
                        return false;
                    }
                } else if (isRedFlag3Raised) {
                    this._log(
                        `${FLAGMD_REDFLAG3} or ${FLAGMD_REDFLAG3_HR} has been detected! Self-hosted LiveSync will discard the local database and fetch everything from the remote once again.`,
                        LOG_LEVEL_NOTICE
                    );
                    const method1 = $msg("RedFlag.Fetch.Method.FetchSafer");
                    const method2 = $msg("RedFlag.Fetch.Method.FetchSmoother");
                    const method3 = $msg("RedFlag.Fetch.Method.FetchTraditional");

                    const methods = [method1, method2, method3] as const;
                    const chunkMode = await this.core.confirm.askSelectStringDialogue(
                        $msg("RedFlag.Fetch.Method.Desc"),
                        methods,
                        {
                            defaultAction: method1,
                            timeout: 0,
                            title: $msg("RedFlag.Fetch.Method.Title"),
                        }
                    );
                    let makeLocalChunkBeforeSync = false;
                    let makeLocalFilesBeforeSync = false;
                    if (chunkMode === method1) {
                        makeLocalFilesBeforeSync = true;
                    } else if (chunkMode === method2) {
                        makeLocalChunkBeforeSync = true;
                    } else if (chunkMode === method3) {
                        // Do nothing.
                    } else {
                        this._log("Cancelled the fetch operation", LOG_LEVEL_NOTICE);
                        return false;
                    }

                    const optionFetchRemoteConf = $msg("RedFlag.FetchRemoteConfig.Buttons.Fetch");
                    const optionCancel = $msg("RedFlag.FetchRemoteConfig.Buttons.Cancel");
                    const fetchRemote = await this.core.confirm.askSelectStringDialogue(
                        $msg("RedFlag.FetchRemoteConfig.Message"),
                        [optionFetchRemoteConf, optionCancel],
                        {
                            defaultAction: optionFetchRemoteConf,
                            timeout: 0,
                            title: $msg("RedFlag.FetchRemoteConfig.Title"),
                        }
                    );
                    if (fetchRemote === optionFetchRemoteConf) {
                        this._log("Fetching remote configuration", LOG_LEVEL_NOTICE);
                        const newSettings = JSON.parse(JSON.stringify(this.core.settings)) as ObsidianLiveSyncSettings;
                        const remoteConfig = await this.core.$$fetchRemotePreferredTweakValues(newSettings);
                        if (remoteConfig) {
                            this._log("Remote configuration found.", LOG_LEVEL_NOTICE);
                            const mergedSettings = {
                                ...this.core.settings,
                                ...remoteConfig,
                            } satisfies ObsidianLiveSyncSettings;
                            this._log("Remote configuration applied.", LOG_LEVEL_NOTICE);
                            this.core.settings = mergedSettings;
                        } else {
                            this._log("Remote configuration not applied.", LOG_LEVEL_NOTICE);
                        }
                    }

                    await this.core.rebuilder.$fetchLocal(makeLocalChunkBeforeSync, !makeLocalFilesBeforeSync);

                    await this.deleteRedFlag3();
                    if (this.settings.suspendFileWatching) {
                        if (
                            (await this.core.confirm.askYesNoDialog(
                                "Do you want to resume file and database processing, and restart obsidian now?",
                                { defaultOption: "Yes", timeout: 15 }
                            )) == "yes"
                        ) {
                            this.settings.suspendFileWatching = false;
                            await this.saveSettings();
                            this.core.$$performRestart();
                            return false;
                        }
                    } else {
                        this._log(
                            "Your content of files will be synchronised gradually. Please wait for the completion.",
                            LOG_LEVEL_NOTICE
                        );
                    }
                } else {
                    // Case of FLAGMD_REDFLAG.
                    this.settings.writeLogToTheFile = true;
                    // await this.plugin.openDatabase();
                    const warningMessage =
                        "The red flag is raised! The whole initialize steps are skipped, and any file changes are not captured.";
                    this._log(warningMessage, LOG_LEVEL_NOTICE);
                }
            }
        } catch (ex) {
            this._log("Something went wrong on FlagFile Handling", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }
        return true;
    }
}
