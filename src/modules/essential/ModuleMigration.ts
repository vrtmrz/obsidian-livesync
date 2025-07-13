import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { type ObsidianLiveSyncSettings } from "../../lib/src/common/types.js";
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
import { checkUnsuitableValues, RuleLevel, type RuleForType } from "../../lib/src/common/configForDoc.ts";
import { getConfName, type AllSettingItemKey } from "../features/SettingDialogue/settingConstants.ts";

export class ModuleMigration extends AbstractModule implements ICoreModule {
    async migrateUsingDoctor(skipRebuild: boolean = false, activateReason = "updated", forceRescan = false) {
        const r = checkUnsuitableValues(this.core.settings);
        if (!forceRescan && r.version == this.settings.doctorProcessedVersion) {
            const isIssueFound = Object.keys(r.rules).length > 0;
            const msg = isIssueFound ? "Issues found" : "No issues found";
            this._log(`${msg} but marked as to be silent`, LOG_LEVEL_VERBOSE);
            return;
        }
        const issues = Object.entries(r.rules);
        if (issues.length == 0) {
            this._log(
                $msg("Doctor.Message.NoIssues"),
                activateReason !== "updated" ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
            );
            return;
        } else {
            const OPT_YES = `${$msg("Doctor.Button.Yes")}` as const;
            const OPT_NO = `${$msg("Doctor.Button.No")}` as const;
            const OPT_DISMISS = `${$msg("Doctor.Button.DismissThisVersion")}` as const;
            // this._log(`Issues found in ${key}`, LOG_LEVEL_VERBOSE);
            const issues = Object.keys(r.rules)
                .map((key) => `- ${getConfName(key as AllSettingItemKey)}`)
                .join("\n");
            const msg = await this.core.confirm.askSelectStringDialogue(
                $msg("Doctor.Dialogue.Main", { activateReason, issues }),
                [OPT_YES, OPT_NO, OPT_DISMISS],
                {
                    title: $msg("Doctor.Dialogue.Title"),
                    defaultAction: OPT_YES,
                }
            );
            if (msg == OPT_DISMISS) {
                this.settings.doctorProcessedVersion = r.version;
                await this.core.saveSettings();
                this._log("Marked as to be silent", LOG_LEVEL_VERBOSE);
                return;
            }
            if (msg != OPT_YES) return;
            let shouldRebuild = false;
            let shouldRebuildLocal = false;
            const issueItems = Object.entries(r.rules) as [keyof ObsidianLiveSyncSettings, RuleForType<any>][];
            this._log(`${issueItems.length} Issue(s) found `, LOG_LEVEL_VERBOSE);
            let idx = 0;
            const applySettings = {} as Partial<ObsidianLiveSyncSettings>;
            const OPT_FIX = `${$msg("Doctor.Button.Fix")}` as const;
            const OPT_SKIP = `${$msg("Doctor.Button.Skip")}` as const;
            const OPT_FIXBUTNOREBUILD = `${$msg("Doctor.Button.FixButNoRebuild")}` as const;
            let skipped = 0;
            for (const [key, value] of issueItems) {
                const levelMap = {
                    [RuleLevel.Necessary]: $msg("Doctor.Level.Necessary"),
                    [RuleLevel.Recommended]: $msg("Doctor.Level.Recommended"),
                    [RuleLevel.Optional]: $msg("Doctor.Level.Optional"),
                    [RuleLevel.Must]: $msg("Doctor.Level.Must"),
                };
                const level = value.level ? levelMap[value.level] : "Unknown";
                const options = [OPT_FIX] as [typeof OPT_FIX | typeof OPT_SKIP | typeof OPT_FIXBUTNOREBUILD];
                if ((!skipRebuild && value.requireRebuild) || value.requireRebuildLocal) {
                    options.push(OPT_FIXBUTNOREBUILD);
                }
                options.push(OPT_SKIP);
                const note = skipRebuild
                    ? ""
                    : `${value.requireRebuild ? $msg("Doctor.Message.RebuildRequired") : ""}${value.requireRebuildLocal ? $msg("Doctor.Message.RebuildLocalRequired") : ""}`;

                const ret = await this.core.confirm.askSelectStringDialogue(
                    $msg("Doctor.Dialogue.MainFix", {
                        name: getConfName(key as AllSettingItemKey),
                        current: `${this.settings[key]}`,
                        reason: value.reasonFunc?.(this.settings) ?? value.reason ?? " N/A ",
                        ideal: `${value.valueDisplayFunc ? value.valueDisplayFunc(this.settings) : value.value}`,
                        //@ts-ignore
                        level: `${level}`,
                        note: note,
                    }),
                    options,
                    {
                        title: $msg("Doctor.Dialogue.TitleFix", { current: `${++idx}`, total: `${issueItems.length}` }),
                        defaultAction: OPT_FIX,
                    }
                );

                if (ret == OPT_FIX || ret == OPT_FIXBUTNOREBUILD) {
                    //@ts-ignore
                    applySettings[key] = value.value;
                    if (ret == OPT_FIX) {
                        shouldRebuild = shouldRebuild || value.requireRebuild || false;
                        shouldRebuildLocal = shouldRebuildLocal || value.requireRebuildLocal || false;
                    }
                } else {
                    skipped++;
                }
            }
            if (Object.keys(applySettings).length > 0) {
                this.settings = {
                    ...this.settings,
                    ...applySettings,
                };
            }
            if (skipped == 0) {
                this.settings.doctorProcessedVersion = r.version;
            } else {
                if (
                    (await this.core.confirm.askYesNoDialog($msg("Doctor.Message.SomeSkipped"), {
                        title: $msg("Doctor.Dialogue.TitleAlmostDone"),
                        defaultOption: "No",
                    })) == "no"
                ) {
                    // Some skipped, and user wants
                    this.settings.doctorProcessedVersion = r.version;
                }
            }
            await this.core.saveSettings();
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
