import { Logger, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { extractObject } from "octagonal-wheels/object";
import {
    TweakValuesShouldMatchedTemplate,
    IncompatibleChanges,
    confName,
    type TweakValues,
    type RemoteDBSettings,
    IncompatibleChangesInSpecificPattern,
    CompatibleButLossyChanges,
} from "../../lib/src/common/types.ts";
import { escapeMarkdownValue } from "../../lib/src/common/utils.ts";
import { AbstractModule } from "../AbstractModule.ts";
import { $msg } from "../../lib/src/common/i18n.ts";
import type { InjectableServiceHub } from "../../lib/src/services/InjectableServices.ts";
import type { LiveSyncCore } from "../../main.ts";

export class ModuleResolvingMismatchedTweaks extends AbstractModule {
    async _anyAfterConnectCheckFailed(): Promise<boolean | "CHECKAGAIN" | undefined> {
        if (!this.core.replicator.tweakSettingsMismatched && !this.core.replicator.preferredTweakValue) return false;
        const preferred = this.core.replicator.preferredTweakValue;
        if (!preferred) return false;
        const ret = await this.services.tweakValue.askResolvingMismatched(preferred);
        if (ret == "OK") return false;
        if (ret == "CHECKAGAIN") return "CHECKAGAIN";
        if (ret == "IGNORE") return true;
    }

    async _checkAndAskResolvingMismatchedTweaks(
        preferred: Partial<TweakValues>
    ): Promise<[TweakValues | boolean, boolean]> {
        const mine = extractObject(TweakValuesShouldMatchedTemplate, this.settings);
        const items = Object.entries(TweakValuesShouldMatchedTemplate);
        let rebuildRequired = false;
        let rebuildRecommended = false;
        // Making tables:
        // let table = `| Value name | This device | Configured | \n` + `|: --- |: --- :|: ---- :| \n`;
        const tableRows = [];
        // const items = [mine,preferred]
        for (const v of items) {
            const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
            const valueMine = escapeMarkdownValue(mine[key]);
            const valuePreferred = escapeMarkdownValue(preferred[key]);
            if (valueMine == valuePreferred) continue;
            if (IncompatibleChanges.indexOf(key) !== -1) {
                rebuildRequired = true;
            }
            for (const pattern of IncompatibleChangesInSpecificPattern) {
                if (pattern.key !== key) continue;
                // if from value supplied, check if current value have been violated : in other words, if the current value is the same as the from value, it should require a rebuild.
                const isFromConditionMet = "from" in pattern ? pattern.from === mine[key] : false;
                // and, if to value supplied, same as above.
                const isToConditionMet = "to" in pattern ? pattern.to === preferred[key] : false;
                // if either of them is true, it should require a rebuild, if the pattern is not a recommendation.
                if (isFromConditionMet || isToConditionMet) {
                    if (pattern.isRecommendation) {
                        rebuildRecommended = true;
                    } else {
                        rebuildRequired = true;
                    }
                }
            }
            if (CompatibleButLossyChanges.indexOf(key) !== -1) {
                rebuildRecommended = true;
            }

            // table += `| ${confName(key)} | ${valueMine} | ${valuePreferred} | \n`;
            tableRows.push(
                $msg("TweakMismatchResolve.Table.Row", {
                    name: confName(key),
                    self: valueMine,
                    remote: valuePreferred,
                })
            );
        }

        const additionalMessage =
            rebuildRequired && this.core.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.WarningIncompatibleRebuildRequired")
                : "";
        const additionalMessage2 =
            rebuildRecommended && this.core.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.WarningIncompatibleRebuildRecommended")
                : "";

        const table = $msg("TweakMismatchResolve.Table", { rows: tableRows.join("\n") });

        const message = $msg("TweakMismatchResolve.Message.MainTweakResolving", {
            table: table,
            additionalMessage: [additionalMessage, additionalMessage2].filter((v) => v).join("\n"),
        });

        const CHOICE_USE_REMOTE = $msg("TweakMismatchResolve.Action.UseRemote");
        const CHOICE_USE_REMOTE_WITH_REBUILD = $msg("TweakMismatchResolve.Action.UseRemoteWithRebuild");
        const CHOICE_USE_REMOTE_PREVENT_REBUILD = $msg("TweakMismatchResolve.Action.UseRemoteAcceptIncompatible");
        const CHOICE_USE_MINE = $msg("TweakMismatchResolve.Action.UseMine");
        const CHOICE_USE_MINE_WITH_REBUILD = $msg("TweakMismatchResolve.Action.UseMineWithRebuild");
        const CHOICE_USE_MINE_PREVENT_REBUILD = $msg("TweakMismatchResolve.Action.UseMineAcceptIncompatible");
        const CHOICE_DISMISS = $msg("TweakMismatchResolve.Action.Dismiss");

        const CHOICE_AND_VALUES = [] as [string, [result: TweakValues | boolean, rebuild: boolean]][];

        if (rebuildRequired) {
            CHOICE_AND_VALUES.push([CHOICE_USE_REMOTE_WITH_REBUILD, [preferred, true]]);
            CHOICE_AND_VALUES.push([CHOICE_USE_MINE_WITH_REBUILD, [true, true]]);
            CHOICE_AND_VALUES.push([CHOICE_USE_REMOTE_PREVENT_REBUILD, [preferred, false]]);
            CHOICE_AND_VALUES.push([CHOICE_USE_MINE_PREVENT_REBUILD, [true, false]]);
        } else if (rebuildRecommended) {
            CHOICE_AND_VALUES.push([CHOICE_USE_REMOTE, [preferred, false]]);
            CHOICE_AND_VALUES.push([CHOICE_USE_MINE, [true, false]]);
            CHOICE_AND_VALUES.push([CHOICE_USE_REMOTE_WITH_REBUILD, [true, true]]);
            CHOICE_AND_VALUES.push([CHOICE_USE_MINE_WITH_REBUILD, [true, true]]);
        } else {
            CHOICE_AND_VALUES.push([CHOICE_USE_REMOTE, [preferred, false]]);
            CHOICE_AND_VALUES.push([CHOICE_USE_MINE, [true, false]]);
        }
        CHOICE_AND_VALUES.push([CHOICE_DISMISS, [false, false]]);
        const CHOICES = Object.fromEntries(CHOICE_AND_VALUES) as Record<
            string,
            [TweakValues | boolean, performRebuild: boolean]
        >;
        const retKey = await this.core.confirm.askSelectStringDialogue(message, Object.keys(CHOICES), {
            title: $msg("TweakMismatchResolve.Title.TweakResolving"),
            timeout: 60,
            defaultAction: CHOICE_DISMISS,
        });
        if (!retKey) return [false, false];
        return CHOICES[retKey];
    }

    async _askResolvingMismatchedTweaks(): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
        if (!this.core.replicator.tweakSettingsMismatched) {
            return "OK";
        }
        const tweaks = this.core.replicator.preferredTweakValue;
        if (!tweaks) {
            return "IGNORE";
        }
        const preferred = extractObject(TweakValuesShouldMatchedTemplate, tweaks);

        const [conf, rebuildRequired] = await this.services.tweakValue.checkAndAskResolvingMismatched(preferred);
        if (!conf) return "IGNORE";

        if (conf === true) {
            await this.core.replicator.setPreferredRemoteTweakSettings(this.settings);
            if (rebuildRequired) {
                await this.core.rebuilder.$rebuildRemote();
            }
            Logger(
                `Tweak values on the remote server have been updated. Your other device will see this message.`,
                LOG_LEVEL_NOTICE
            );
            return "CHECKAGAIN";
        }
        if (conf) {
            this.settings = { ...this.settings, ...conf };
            await this.core.replicator.setPreferredRemoteTweakSettings(this.settings);
            await this.services.setting.saveSettingData();
            if (rebuildRequired) {
                await this.core.rebuilder.$fetchLocal();
            }
            Logger(`Configuration has been updated as configured by the other device.`, LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        return "IGNORE";
    }

    async _fetchRemotePreferredTweakValues(trialSetting: RemoteDBSettings): Promise<TweakValues | false> {
        const replicator = await this.services.replicator.getNewReplicator(trialSetting);
        if (!replicator) {
            this._log("The remote type is not supported for fetching preferred tweak values.", LOG_LEVEL_NOTICE);
            return false;
        }
        if (await replicator.tryConnectRemote(trialSetting)) {
            const preferred = await replicator.getRemotePreferredTweakValues(trialSetting);
            if (preferred) {
                return preferred;
            }
            this._log("Failed to get the preferred tweak values from the remote server.", LOG_LEVEL_NOTICE);
            return false;
        }
        this._log("Failed to connect to the remote server.", LOG_LEVEL_NOTICE);
        return false;
    }

    async _checkAndAskUseRemoteConfiguration(
        trialSetting: RemoteDBSettings
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        const preferred = await this.services.tweakValue.fetchRemotePreferred(trialSetting);
        if (preferred) {
            return await this.services.tweakValue.askUseRemoteConfiguration(trialSetting, preferred);
        }
        return { result: false, requireFetch: false };
    }

    async _askUseRemoteConfiguration(
        trialSetting: RemoteDBSettings,
        preferred: TweakValues
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        const items = Object.entries(TweakValuesShouldMatchedTemplate);
        let rebuildRequired = false;
        let rebuildRecommended = false;
        // Making tables:
        // let table = `| Value name | This device | On Remote | \n` + `|: --- |: ---- :|: ---- :| \n`;
        let differenceCount = 0;
        const tableRows = [] as string[];
        // const items = [mine,preferred]
        for (const v of items) {
            const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
            const remoteValueForDisplay = escapeMarkdownValue(preferred[key]);
            const currentValueForDisplay = `${escapeMarkdownValue((trialSetting as TweakValues)?.[key])}`;
            if ((trialSetting as TweakValues)?.[key] !== preferred[key]) {
                if (IncompatibleChanges.indexOf(key) !== -1) {
                    rebuildRequired = true;
                }
                for (const pattern of IncompatibleChangesInSpecificPattern) {
                    if (pattern.key !== key) continue;
                    // if from value supplied, check if current value have been violated : in other words, if the current value is the same as the from value, it should require a rebuild.
                    const isFromConditionMet =
                        "from" in pattern ? pattern.from === (trialSetting as TweakValues)?.[key] : false;
                    // and, if to value supplied, same as above.
                    const isToConditionMet = "to" in pattern ? pattern.to === preferred[key] : false;
                    // if either of them is true, it should require a rebuild, if the pattern is not a recommendation.
                    if (isFromConditionMet || isToConditionMet) {
                        if (pattern.isRecommendation) {
                            rebuildRecommended = true;
                        } else {
                            rebuildRequired = true;
                        }
                    }
                }
                if (CompatibleButLossyChanges.indexOf(key) !== -1) {
                    rebuildRecommended = true;
                }
            } else {
                continue;
            }
            tableRows.push(
                $msg("TweakMismatchResolve.Table.Row", {
                    name: confName(key),
                    self: currentValueForDisplay,
                    remote: remoteValueForDisplay,
                })
            );
            differenceCount++;
        }

        if (differenceCount === 0) {
            this._log("The settings in the remote database are the same as the local database.", LOG_LEVEL_NOTICE);
            return { result: false, requireFetch: false };
        }
        const additionalMessage =
            rebuildRequired && this.core.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.UseRemote.WarningRebuildRequired")
                : "";
        const additionalMessage2 =
            rebuildRecommended && this.core.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.UseRemote.WarningRebuildRecommended")
                : "";

        const table = $msg("TweakMismatchResolve.Table", { rows: tableRows.join("\n") });

        const message = $msg("TweakMismatchResolve.Message.Main", {
            table: table,
            additionalMessage: [additionalMessage, additionalMessage2].filter((v) => v).join("\n"),
        });

        const CHOICE_USE_REMOTE = $msg("TweakMismatchResolve.Action.UseConfigured");
        const CHOICE_DISMISS = $msg("TweakMismatchResolve.Action.Dismiss");
        // const CHOICE_AND_VALUES = [
        //     [CHOICE_USE_REMOTE, preferred],
        //     [CHOICE_DISMISS, false]]
        const CHOICES = [CHOICE_USE_REMOTE, CHOICE_DISMISS];
        const retKey = await this.core.confirm.askSelectStringDialogue(message, CHOICES, {
            title: $msg("TweakMismatchResolve.Title.UseRemoteConfig"),
            timeout: 0,
            defaultAction: CHOICE_DISMISS,
        });
        if (!retKey) return { result: false, requireFetch: false };
        if (retKey === CHOICE_DISMISS) return { result: false, requireFetch: false };
        if (retKey === CHOICE_USE_REMOTE) {
            return { result: { ...trialSetting, ...preferred }, requireFetch: rebuildRequired };
        }
        return { result: false, requireFetch: false };
    }

    override onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.tweakValue.fetchRemotePreferred.setHandler(this._fetchRemotePreferredTweakValues.bind(this));
        services.tweakValue.checkAndAskResolvingMismatched.setHandler(
            this._checkAndAskResolvingMismatchedTweaks.bind(this)
        );
        services.tweakValue.askResolvingMismatched.setHandler(this._askResolvingMismatchedTweaks.bind(this));
        services.tweakValue.checkAndAskUseRemoteConfiguration.setHandler(
            this._checkAndAskUseRemoteConfiguration.bind(this)
        );
        services.tweakValue.askUseRemoteConfiguration.setHandler(this._askUseRemoteConfiguration.bind(this));
        services.replication.checkConnectionFailure.addHandler(this._anyAfterConnectCheckFailed.bind(this));
    }
}
