import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger.js";
import { SETTING_VERSION_SUPPORT_CASE_INSENSITIVE } from "../../lib/src/common/types.js";
import {
    EVENT_REQUEST_OPEN_SETTING_WIZARD,
    EVENT_REQUEST_OPEN_SETTINGS,
    EVENT_REQUEST_OPEN_SETUP_URI,
    eventHub,
} from "../../common/events.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";
import { $msg } from "src/lib/src/common/i18n.ts";

export class ModuleMigration extends AbstractModule implements ICoreModule {
    async migrateDisableBulkSend() {
        if (this.settings.sendChunksBulk) {
            this._log($msg("moduleMigration.logBulkSendCorrupted"), LOG_LEVEL_NOTICE);
            this.settings.sendChunksBulk = false;
            this.settings.sendChunksBulkMaxSize = 1;
            await this.saveSettings();
        }
    }
    async migrationCheck() {
        const old = this.settings.settingVersion;
        const current = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
        // Check each migrations(old -> current)
        if (!(await this.migrateToCaseInsensitive(old, current))) {
            this._log(
                $msg("moduleMigration.logMigrationFailed", {
                    old: old.toString(),
                    current: current.toString(),
                }),
                LOG_LEVEL_NOTICE
            );
            return;
        }
    }
    async migrateToCaseInsensitive(old: number, current: number) {
        if (
            this.settings.handleFilenameCaseSensitive !== undefined &&
            this.settings.doNotUseFixedRevisionForChunks !== undefined
        ) {
            if (current < SETTING_VERSION_SUPPORT_CASE_INSENSITIVE) {
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                await this.saveSettings();
            }
            return true;
        }
        if (
            old >= SETTING_VERSION_SUPPORT_CASE_INSENSITIVE &&
            this.settings.handleFilenameCaseSensitive !== undefined &&
            this.settings.doNotUseFixedRevisionForChunks !== undefined
        ) {
            return true;
        }

        let remoteHandleFilenameCaseSensitive: undefined | boolean = undefined;
        let remoteDoNotUseFixedRevisionForChunks: undefined | boolean = undefined;
        let remoteChecked = false;
        try {
            const remoteInfo = await this.core.replicator.getRemotePreferredTweakValues(this.settings);
            if (remoteInfo) {
                remoteHandleFilenameCaseSensitive =
                    "handleFilenameCaseSensitive" in remoteInfo ? remoteInfo.handleFilenameCaseSensitive : false;
                remoteDoNotUseFixedRevisionForChunks =
                    "doNotUseFixedRevisionForChunks" in remoteInfo ? remoteInfo.doNotUseFixedRevisionForChunks : false;
                if (
                    remoteHandleFilenameCaseSensitive !== undefined ||
                    remoteDoNotUseFixedRevisionForChunks !== undefined
                ) {
                    remoteChecked = true;
                }
            } else {
                this._log($msg("moduleMigration.logFetchRemoteTweakFailed"), LOG_LEVEL_INFO);
            }
        } catch (ex) {
            this._log($msg("moduleMigration.logRemoteTweakUnavailable"), LOG_LEVEL_INFO);
            this._log(ex, LOG_LEVEL_VERBOSE);
        }

        if (remoteChecked) {
            // The case that the remote could be checked.
            if (remoteHandleFilenameCaseSensitive && remoteDoNotUseFixedRevisionForChunks) {
                // Migrated, but configured as same as old behaviour.
                this.settings.handleFilenameCaseSensitive = true;
                this.settings.doNotUseFixedRevisionForChunks = true;
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                this._log(
                    $msg("moduleMigration.logMigratedSameBehaviour", {
                        current: current.toString(),
                    }),
                    LOG_LEVEL_INFO
                );
                await this.saveSettings();
                return true;
            }
            const message = $msg("moduleMigration.msgFetchRemoteAgain");
            const OPTION_FETCH = $msg("moduleMigration.optionYesFetchAgain");
            const DISMISS = $msg("moduleMigration.optionNoAskAgain");
            const options = [OPTION_FETCH, DISMISS];
            const ret = await this.core.confirm.confirmWithMessage(
                $msg("moduleMigration.titleCaseSensitivity"),
                message,
                options,
                DISMISS,
                40
            );
            if (ret == OPTION_FETCH) {
                this.settings.handleFilenameCaseSensitive = remoteHandleFilenameCaseSensitive || false;
                this.settings.doNotUseFixedRevisionForChunks = remoteDoNotUseFixedRevisionForChunks || false;
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                await this.saveSettings();
                try {
                    await this.core.rebuilder.scheduleFetch();
                    return;
                } catch (ex) {
                    this._log($msg("moduleMigration.logRedflag2CreationFail"), LOG_LEVEL_VERBOSE);
                    this._log(ex, LOG_LEVEL_VERBOSE);
                }
                return false;
            } else {
                return false;
            }
        }

        const ENABLE_BOTH = $msg("moduleMigration.optionEnableBoth");
        const ENABLE_FILENAME_CASE_INSENSITIVE = $msg("moduleMigration.optionEnableFilenameCaseInsensitive");
        const ENABLE_FIXED_REVISION_FOR_CHUNKS = $msg("moduleMigration.optionEnableFixedRevisionForChunks");
        const ADJUST_TO_REMOTE = $msg("moduleMigration.optionAdjustRemote");
        const KEEP = $msg("moduleMigration.optionKeepPreviousBehaviour");
        const DISMISS = $msg("moduleMigration.optionDecideLater");
        const message = $msg("moduleMigration.msgSinceV02321");
        const options = [ENABLE_BOTH, ENABLE_FILENAME_CASE_INSENSITIVE, ENABLE_FIXED_REVISION_FOR_CHUNKS];
        if (remoteChecked) {
            options.push(ADJUST_TO_REMOTE);
        }
        options.push(KEEP, DISMISS);
        const ret = await this.core.confirm.confirmWithMessage(
            $msg("moduleMigration.titleCaseSensitivity"),
            message,
            options,
            DISMISS,
            40
        );
        console.dir(ret);
        switch (ret) {
            case ENABLE_BOTH:
                this.settings.handleFilenameCaseSensitive = false;
                this.settings.doNotUseFixedRevisionForChunks = false;
                break;
            case ENABLE_FILENAME_CASE_INSENSITIVE:
                this.settings.handleFilenameCaseSensitive = false;
                this.settings.doNotUseFixedRevisionForChunks = true;
                break;
            case ENABLE_FIXED_REVISION_FOR_CHUNKS:
                this.settings.doNotUseFixedRevisionForChunks = false;
                this.settings.handleFilenameCaseSensitive = true;
                break;
            case KEEP:
                this.settings.handleFilenameCaseSensitive = true;
                this.settings.doNotUseFixedRevisionForChunks = true;
                this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
                await this.saveSettings();
                return true;
            case DISMISS:
            default:
                return false;
        }
        this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
        await this.saveSettings();
        await this.core.rebuilder.scheduleRebuild();
        await this.core.$$performRestart();
    }

    async initialMessage() {
        const message = $msg("moduleMigration.msgInitialSetup", {
            URI_DOC: $msg("moduleMigration.docUri"),
        });
        const USE_SETUP = $msg("moduleMigration.optionHaveSetupUri");
        const NEXT = $msg("moduleMigration.optionNoSetupUri");

        const ret = await this.core.confirm.askSelectStringDialogue(message, [USE_SETUP, NEXT], {
            title: $msg("moduleMigration.titleWelcome"),
            defaultAction: USE_SETUP,
        });
        if (ret === USE_SETUP) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETUP_URI);
            return false;
        } else if (ret == NEXT) {
            return true;
        }
        return false;
    }

    async askAgainForSetupURI() {
        const message = $msg("moduleMigration.msgRecommendSetupUri", { URI_DOC: $msg("moduleMigration.docUri") });
        const USE_MINIMAL = $msg("moduleMigration.optionSetupWizard");
        const USE_SETUP = $msg("moduleMigration.optionManualSetup");
        const NEXT = $msg("moduleMigration.optionRemindNextLaunch");

        const ret = await this.core.confirm.askSelectStringDialogue(message, [USE_MINIMAL, USE_SETUP, NEXT], {
            title: $msg("moduleMigration.titleRecommendSetupUri"),
            defaultAction: USE_MINIMAL,
        });
        if (ret === USE_MINIMAL) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETTING_WIZARD);
            return false;
        }
        if (ret === USE_SETUP) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETTINGS);
            return false;
        } else if (ret == NEXT) {
            return false;
        }
        return false;
    }

    async $everyOnFirstInitialize(): Promise<boolean> {
        if (!this.localDatabase.isReady) {
            this._log($msg("moduleMigration.logLocalDatabaseNotReady"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (this.settings.isConfigured) {
            await this.migrationCheck();
            await this.migrateDisableBulkSend();
        }
        if (!this.settings.isConfigured) {
            // Case sensitivity
            if (!(await this.initialMessage()) || !(await this.askAgainForSetupURI())) {
                this._log($msg("moduleMigration.logSetupCancelled"), LOG_LEVEL_NOTICE);
                return false;
            }
        }
        return true;
    }
}
