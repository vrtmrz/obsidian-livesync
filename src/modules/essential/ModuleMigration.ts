import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger.js";
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
                        reason: value.reason ?? " N/A ",
                        ideal: `${value.value}`,
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
    // async migrationCheck() {
    //     const old = this.settings.settingVersion;
    //     const current = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
    //     // Check each migrations(old -> current)
    //     if (!(await this.migrateToCaseInsensitive(old, current))) {
    //         this._log(
    //             $msg("moduleMigration.logMigrationFailed", {
    //                 old: old.toString(),
    //                 current: current.toString(),
    //             }),
    //             LOG_LEVEL_NOTICE
    //         );
    //         return;
    //     }
    // }
    // async migrateToCaseInsensitive(old: number, current: number) {
    //     if (
    //         this.settings.handleFilenameCaseSensitive !== undefined &&
    //         this.settings.doNotUseFixedRevisionForChunks !== undefined
    //     ) {
    //         if (current < SETTING_VERSION_SUPPORT_CASE_INSENSITIVE) {
    //             this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
    //             await this.saveSettings();
    //         }
    //         return true;
    //     }
    //     if (
    //         old >= SETTING_VERSION_SUPPORT_CASE_INSENSITIVE &&
    //         this.settings.handleFilenameCaseSensitive !== undefined &&
    //         this.settings.doNotUseFixedRevisionForChunks !== undefined
    //     ) {
    //         return true;
    //     }

    //     let remoteHandleFilenameCaseSensitive: undefined | boolean = undefined;
    //     let remoteDoNotUseFixedRevisionForChunks: undefined | boolean = undefined;
    //     let remoteChecked = false;
    //     try {
    //         const remoteInfo = await this.core.replicator.getRemotePreferredTweakValues(this.settings);
    //         if (remoteInfo) {
    //             remoteHandleFilenameCaseSensitive =
    //                 "handleFilenameCaseSensitive" in remoteInfo ? remoteInfo.handleFilenameCaseSensitive : false;
    //             remoteDoNotUseFixedRevisionForChunks =
    //                 "doNotUseFixedRevisionForChunks" in remoteInfo ? remoteInfo.doNotUseFixedRevisionForChunks : false;
    //             if (
    //                 remoteHandleFilenameCaseSensitive !== undefined ||
    //                 remoteDoNotUseFixedRevisionForChunks !== undefined
    //             ) {
    //                 remoteChecked = true;
    //             }
    //         } else {
    //             this._log($msg("moduleMigration.logFetchRemoteTweakFailed"), LOG_LEVEL_INFO);
    //         }
    //     } catch (ex) {
    //         this._log($msg("moduleMigration.logRemoteTweakUnavailable"), LOG_LEVEL_INFO);
    //         this._log(ex, LOG_LEVEL_VERBOSE);
    //     }

    //     if (remoteChecked) {
    //         // The case that the remote could be checked.
    //         if (remoteHandleFilenameCaseSensitive && remoteDoNotUseFixedRevisionForChunks) {
    //             // Migrated, but configured as same as old behaviour.
    //             this.settings.handleFilenameCaseSensitive = true;
    //             this.settings.doNotUseFixedRevisionForChunks = true;
    //             this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
    //             this._log(
    //                 $msg("moduleMigration.logMigratedSameBehaviour", {
    //                     current: current.toString(),
    //                 }),
    //                 LOG_LEVEL_INFO
    //             );
    //             await this.saveSettings();
    //             return true;
    //         }
    //         const message = $msg("moduleMigration.msgFetchRemoteAgain");
    //         const OPTION_FETCH = $msg("moduleMigration.optionYesFetchAgain");
    //         const DISMISS = $msg("moduleMigration.optionNoAskAgain");
    //         const options = [OPTION_FETCH, DISMISS];
    //         const ret = await this.core.confirm.confirmWithMessage(
    //             $msg("moduleMigration.titleCaseSensitivity"),
    //             message,
    //             options,
    //             DISMISS,
    //             40
    //         );
    //         if (ret == OPTION_FETCH) {
    //             this.settings.handleFilenameCaseSensitive = remoteHandleFilenameCaseSensitive || false;
    //             this.settings.doNotUseFixedRevisionForChunks = remoteDoNotUseFixedRevisionForChunks || false;
    //             this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
    //             await this.saveSettings();
    //             try {
    //                 await this.core.rebuilder.scheduleFetch();
    //                 return;
    //             } catch (ex) {
    //                 this._log($msg("moduleMigration.logRedflag2CreationFail"), LOG_LEVEL_VERBOSE);
    //                 this._log(ex, LOG_LEVEL_VERBOSE);
    //             }
    //             return false;
    //         } else {
    //             return false;
    //         }
    //     }

    //     const ENABLE_BOTH = $msg("moduleMigration.optionEnableBoth");
    //     const ENABLE_FILENAME_CASE_INSENSITIVE = $msg("moduleMigration.optionEnableFilenameCaseInsensitive");
    //     const ENABLE_FIXED_REVISION_FOR_CHUNKS = $msg("moduleMigration.optionEnableFixedRevisionForChunks");
    //     const ADJUST_TO_REMOTE = $msg("moduleMigration.optionAdjustRemote");
    //     const KEEP = $msg("moduleMigration.optionKeepPreviousBehaviour");
    //     const DISMISS = $msg("moduleMigration.optionDecideLater");
    //     const message = $msg("moduleMigration.msgSinceV02321");
    //     const options = [ENABLE_BOTH, ENABLE_FILENAME_CASE_INSENSITIVE, ENABLE_FIXED_REVISION_FOR_CHUNKS];
    //     if (remoteChecked) {
    //         options.push(ADJUST_TO_REMOTE);
    //     }
    //     options.push(KEEP, DISMISS);
    //     const ret = await this.core.confirm.confirmWithMessage(
    //         $msg("moduleMigration.titleCaseSensitivity"),
    //         message,
    //         options,
    //         DISMISS,
    //         40
    //     );
    //     console.dir(ret);
    //     switch (ret) {
    //         case ENABLE_BOTH:
    //             this.settings.handleFilenameCaseSensitive = false;
    //             this.settings.doNotUseFixedRevisionForChunks = false;
    //             break;
    //         case ENABLE_FILENAME_CASE_INSENSITIVE:
    //             this.settings.handleFilenameCaseSensitive = false;
    //             this.settings.doNotUseFixedRevisionForChunks = true;
    //             break;
    //         case ENABLE_FIXED_REVISION_FOR_CHUNKS:
    //             this.settings.doNotUseFixedRevisionForChunks = false;
    //             this.settings.handleFilenameCaseSensitive = true;
    //             break;
    //         case KEEP:
    //             this.settings.handleFilenameCaseSensitive = true;
    //             this.settings.doNotUseFixedRevisionForChunks = true;
    //             this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
    //             await this.saveSettings();
    //             return true;
    //         case DISMISS:
    //         default:
    //             return false;
    //     }
    //     this.settings.settingVersion = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;
    //     await this.saveSettings();
    //     await this.core.rebuilder.scheduleRebuild();
    //     await this.core.$$performRestart();
    // }

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
