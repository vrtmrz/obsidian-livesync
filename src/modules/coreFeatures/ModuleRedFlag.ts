import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { normalizePath } from "../../deps.ts";
import { FLAGMD_REDFLAG, FLAGMD_REDFLAG2, FLAGMD_REDFLAG2_HR, FLAGMD_REDFLAG3, FLAGMD_REDFLAG3_HR } from "../../lib/src/common/types.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

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

    isRedFlagRaised = async () => await this.isFlagFileExist(FLAGMD_REDFLAG)
    isRedFlag2Raised = async () => await this.isFlagFileExist(FLAGMD_REDFLAG2) || await this.isFlagFileExist(FLAGMD_REDFLAG2_HR)
    isRedFlag3Raised = async () => await this.isFlagFileExist(FLAGMD_REDFLAG3) || await this.isFlagFileExist(FLAGMD_REDFLAG3_HR)

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
                    if (await this.core.confirm.askYesNoDialog("Rebuild everything has been scheduled! Are you sure to rebuild everything?", { defaultOption: "Yes", timeout: 0 }) !== "yes") {
                        await this.deleteRedFlag2();
                        await this.core.$$performRestart();
                        return false;
                    }
                }
                if (isRedFlag3Raised) {
                    if (await this.core.confirm.askYesNoDialog("Fetch again has been scheduled! Are you sure?", { defaultOption: "Yes", timeout: 0 }) !== "yes") {
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
                    this._log(`${FLAGMD_REDFLAG2} or ${FLAGMD_REDFLAG2_HR} has been detected! Self-hosted LiveSync suspends all sync and rebuild everything.`, LOG_LEVEL_NOTICE);
                    await this.core.rebuilder.$rebuildEverything();
                    await this.deleteRedFlag2();
                    if (await this.core.confirm.askYesNoDialog("Do you want to resume file and database processing, and restart obsidian now?", { defaultOption: "Yes", timeout: 15 }) == "yes") {
                        this.settings.suspendFileWatching = false;
                        await this.saveSettings();
                        this.core.$$performRestart();
                        return false;
                    }
                } else if (isRedFlag3Raised) {
                    this._log(`${FLAGMD_REDFLAG3} or ${FLAGMD_REDFLAG3_HR} has been detected! Self-hosted LiveSync will discard the local database and fetch everything from the remote once again.`, LOG_LEVEL_NOTICE);
                    const makeLocalChunkBeforeSync = ((await this.core.confirm.askYesNoDialog("Do you want to create local chunks before fetching?", { defaultOption: "Yes" })) == "yes");
                    await this.core.rebuilder.$fetchLocal(makeLocalChunkBeforeSync);
                    await this.deleteRedFlag3();
                    if (this.settings.suspendFileWatching) {
                        if (await this.core.confirm.askYesNoDialog("Do you want to resume file and database processing, and restart obsidian now?", { defaultOption: "Yes", timeout: 15 }) == "yes") {
                            this.settings.suspendFileWatching = false;
                            await this.saveSettings();
                            this.core.$$performRestart();
                            return false;
                        }
                    }
                } else {
                    // Case of FLAGMD_REDFLAG.
                    this.settings.writeLogToTheFile = true;
                    // await this.plugin.openDatabase();
                    const warningMessage = "The red flag is raised! The whole initialize steps are skipped, and any file changes are not captured.";
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