import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import {
    EVENT_REQUEST_OPEN_P2P,
    EVENT_REQUEST_OPEN_SETTING_WIZARD,
    EVENT_REQUEST_OPEN_SETTINGS,
    EVENT_REQUEST_OPEN_SETUP_URI,
    EVENT_REQUEST_RUN_DOCTOR,
    eventHub,
} from "../../common/events.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";
import { $msg } from "src/lib/src/common/i18n.ts";
import { performDoctorConsultation, RebuildOptions } from "../../lib/src/common/configForDoc.ts";

export class ModuleMigration extends AbstractModule implements ICoreModule {
    async migrateUsingDoctor(skipRebuild: boolean = false, activateReason = "updated", forceRescan = false) {
        const { shouldRebuild, shouldRebuildLocal, isModified, settings } = await performDoctorConsultation(
            this.core,
            this.settings,
            {
                localRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                remoteRebuild: skipRebuild ? RebuildOptions.SkipEvenIfRequired : RebuildOptions.AutomaticAcceptable,
                activateReason,
                forceRescan,
            }
        );
        if (isModified) {
            this.settings = settings;
            await this.core.saveSettings();
        }
        if (!skipRebuild) {
            if (shouldRebuild) {
                await this.core.rebuilder.scheduleRebuild();
                await this.core.$$performRestart();
            } else if (shouldRebuildLocal) {
                await this.core.rebuilder.scheduleFetch();
                await this.core.$$performRestart();
            }
        }
    }

    async migrateDisableBulkSend() {
        if (this.settings.sendChunksBulk) {
            this._log($msg("moduleMigration.logBulkSendCorrupted"), LOG_LEVEL_NOTICE);
            this.settings.sendChunksBulk = false;
            this.settings.sendChunksBulkMaxSize = 1;
            await this.saveSettings();
        }
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
        const USE_P2P = $msg("moduleMigration.optionSetupViaP2P");
        const USE_SETUP = $msg("moduleMigration.optionManualSetup");
        const NEXT = $msg("moduleMigration.optionRemindNextLaunch");

        const ret = await this.core.confirm.askSelectStringDialogue(message, [USE_MINIMAL, USE_SETUP, USE_P2P, NEXT], {
            title: $msg("moduleMigration.titleRecommendSetupUri"),
            defaultAction: USE_MINIMAL,
        });
        if (ret === USE_MINIMAL) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_SETTING_WIZARD);
            return false;
        }
        if (ret === USE_P2P) {
            eventHub.emitEvent(EVENT_REQUEST_OPEN_P2P);
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
            await this.migrateUsingDoctor(false);
            // await this.migrationCheck();
            await this.migrateDisableBulkSend();
        }
        if (!this.settings.isConfigured) {
            // Case sensitivity
            if (!(await this.initialMessage()) || !(await this.askAgainForSetupURI())) {
                this._log($msg("moduleMigration.logSetupCancelled"), LOG_LEVEL_NOTICE);
                return false;
            }
            await this.migrateUsingDoctor(true);
        }
        return true;
    }
    $everyOnLayoutReady(): Promise<boolean> {
        eventHub.onEvent(EVENT_REQUEST_RUN_DOCTOR, async (reason) => {
            await this.migrateUsingDoctor(false, reason, true);
        });
        return Promise.resolve(true);
    }
}
