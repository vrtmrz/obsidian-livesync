import { Logger, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { extractObject } from "octagonal-wheels/object";
import {
    TweakValuesShouldMatchedTemplate,
    TweakValuesTemplate,
    IncompatibleChanges,
    confName,
    type TweakValues,
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    IncompatibleChangesInSpecificPattern,
    CompatibleButLossyChanges,
} from "@lib/common/types.ts";
import { escapeMarkdownValue } from "@lib/common/utils.ts";
import { $msg } from "@lib/common/i18n.ts";
import { REMOTE_P2P } from "@lib/common/models/setting.const.ts";
import type { NecessaryObsidianFeature } from "@/types";

export type MismatchedTweaksResolverHost = NecessaryObsidianFeature<
    "setting" | "tweakValue" | "replication" | "replicator" | "UI",
    "rebuilder"
>;

export function valueToString(value: string | number | boolean | object | undefined): string {
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return `${value}`;
}

export const collectMismatchedTweakKeys = (current: TweakValues, preferred: Partial<TweakValues>) => {
    const items = Object.keys(TweakValuesShouldMatchedTemplate) as (keyof typeof TweakValuesShouldMatchedTemplate)[];
    return items.filter((key) => current[key] !== preferred[key]);
};

export const selectNewerTweakSide = (current: TweakValues, preferred: Partial<TweakValues>): "REMOTE" | "CURRENT" => {
    Logger(`Modified: ${current.tweakModified} (current) vs ${preferred.tweakModified} (preferred)`);
    const currentModified = current.tweakModified;
    const preferredModified = preferred.tweakModified;
    const hasCurrentModified = typeof currentModified === "number" && currentModified > 0;
    const hasPreferredModified = typeof preferredModified === "number" && preferredModified > 0;

    if (!hasCurrentModified && !hasPreferredModified) return "REMOTE";
    if (!hasCurrentModified) return "REMOTE";
    if (!hasPreferredModified) return "CURRENT";
    if (preferredModified >= currentModified) return "REMOTE";
    return "CURRENT";
};

export const shouldAutoAcceptCompatibleLossy = async (
    host: MismatchedTweaksResolverHost,
    state: { hasNotifiedAutoAcceptCompatibleUndefined: boolean },
    current: TweakValues,
    preferred: Partial<TweakValues>,
    mismatchedKeys: (keyof typeof TweakValuesShouldMatchedTemplate)[]
): Promise<"REMOTE" | "CURRENT" | undefined> => {
    const { services } = host;
    if (mismatchedKeys.length === 0) return undefined;
    const hasOnlyCompatibleLossyMismatches = mismatchedKeys.every(
        (key) => CompatibleButLossyChanges.indexOf(key) !== -1
    );
    if (!hasOnlyCompatibleLossyMismatches) return undefined;

    if (services.setting.settings.autoAcceptCompatibleTweak === undefined) {
        if (state.hasNotifiedAutoAcceptCompatibleUndefined) {
            return undefined;
        }
        state.hasNotifiedAutoAcceptCompatibleUndefined = true;
        const CHOICE_ENABLE = $msg("TweakMismatchResolve.Action.EnableAutoAcceptCompatible");
        const CHOICE_DISABLE = $msg("TweakMismatchResolve.Action.DisableAutoAcceptCompatible");
        const CHOICES = [CHOICE_ENABLE, CHOICE_DISABLE] as const;
        const message = $msg("TweakMismatchResolve.Message.AutoAcceptCompatibleUndefined");
        const ret = await host.services.UI?.confirm.askSelectStringDialogue(message, CHOICES, {
            title: $msg("TweakMismatchResolve.Title.AutoAcceptCompatible"),
            timeout: 0,
            defaultAction: CHOICE_ENABLE,
        });
        if (ret !== CHOICE_ENABLE) {
            return undefined;
        }
        await services.setting.applyPartial(
            {
                autoAcceptCompatibleTweak: true,
            },
            true
        );
        Logger("Auto-accept for compatible tweak mismatch has been enabled.");
    }

    if (services.setting.settings.autoAcceptCompatibleTweak !== true) return undefined;
    return selectNewerTweakSide(current, preferred);
};

export const onBeforeSaveSettingDataHandler = async (
    next: ObsidianLiveSyncSettings,
    previous: ObsidianLiveSyncSettings
) => {
    const tweakKeys = Object.keys(TweakValuesTemplate) as (keyof TweakValues)[];
    const tweakKeysForUpdate = tweakKeys.filter((key) => key !== "tweakModified");
    const hasChangedTweak = tweakKeysForUpdate.some((key) => next[key] !== previous[key]);
    if (!hasChangedTweak) return;
    Logger(
        `Some tweak values have been changed. ${tweakKeysForUpdate.filter((key) => next[key] !== previous[key]).join(", ")}`
    );
    const modified = Date.now();
    Logger(`Modified: ${modified}`);
    return await Promise.resolve({
        tweakModified: modified,
    });
};

export const anyAfterConnectCheckFailedHandler = async (
    host: MismatchedTweaksResolverHost
): Promise<boolean | "CHECKAGAIN" | undefined> => {
    const { services } = host;
    if (
        !services.replicator.getActiveReplicator()?.tweakSettingsMismatched &&
        !services.replicator.getActiveReplicator()?.preferredTweakValue
    )
        return false;
    const preferred = services.replicator.getActiveReplicator()?.preferredTweakValue;
    if (!preferred) return false;
    const ret = await services.tweakValue.askResolvingMismatched(preferred);
    if (ret == "OK") return false;
    if (ret == "CHECKAGAIN") return "CHECKAGAIN";
    if (ret == "IGNORE") return true;
};

export const checkAndAskResolvingMismatchedTweaksHandler = async (
    host: MismatchedTweaksResolverHost,
    state: { hasNotifiedAutoAcceptCompatibleUndefined: boolean },
    preferred: TweakValues
): Promise<[TweakValues | boolean, boolean]> => {
    const { services } = host;
    const mine = extractObject(TweakValuesTemplate, services.setting.settings) as TweakValues;
    const mismatchedKeys = collectMismatchedTweakKeys(mine, preferred);
    const autoAcceptSide = await shouldAutoAcceptCompatibleLossy(host, state, mine, preferred, mismatchedKeys);
    if (autoAcceptSide === "REMOTE") {
        return [{ ...mine, ...preferred }, false];
    }
    if (autoAcceptSide === "CURRENT") {
        return [true, false];
    }
    const items = Object.entries(TweakValuesShouldMatchedTemplate);
    let rebuildRequired = false;
    let rebuildRecommended = false;
    const tableRows = [];
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
            const isFromConditionMet = "from" in pattern ? pattern.from === mine[key] : false;
            const isToConditionMet = "to" in pattern ? pattern.to === preferred[key] : false;
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

        tableRows.push(
            $msg("TweakMismatchResolve.Table.Row", {
                name: confName(key),
                self: valueToString(valueMine),
                remote: valueToString(valuePreferred),
            })
        );
    }

    const additionalMessage =
        rebuildRequired && services.setting.settings.isConfigured
            ? $msg("TweakMismatchResolve.Message.WarningIncompatibleRebuildRequired")
            : "";
    const additionalMessage2 =
        rebuildRecommended && services.setting.settings.isConfigured
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
    const retKey = await host.services.UI?.confirm.askSelectStringDialogue(message, Object.keys(CHOICES), {
        title: $msg("TweakMismatchResolve.Title.TweakResolving"),
        timeout: 60,
        defaultAction: CHOICE_DISMISS,
    });
    if (!retKey) return [false, false];
    return CHOICES[retKey];
};

export const askResolvingMismatchedTweaksHandler = async (
    host: MismatchedTweaksResolverHost
): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> => {
    const { services, serviceModules } = host;
    if (!services.replicator.getActiveReplicator()?.tweakSettingsMismatched) {
        return "OK";
    }
    const tweaks = services.replicator.getActiveReplicator()?.preferredTweakValue;
    if (!tweaks) {
        return "IGNORE";
    }
    const [conf, rebuildRequired] = await services.tweakValue.checkAndAskResolvingMismatched(tweaks);
    if (!conf) return "IGNORE";

    if (conf === true) {
        await services.replicator.getActiveReplicator()?.setPreferredRemoteTweakSettings(services.setting.settings);
        if (rebuildRequired) {
            await serviceModules.rebuilder.$rebuildRemote();
        }
        Logger($msg("TweakMismatchResolve.Message.remoteUpdated"), LOG_LEVEL_NOTICE);
        return "CHECKAGAIN";
    }
    if (conf) {
        Object.assign(services.setting.settings, conf);
        await services.replicator.getActiveReplicator()?.setPreferredRemoteTweakSettings(services.setting.settings);
        await services.setting.saveSettingData();
        if (rebuildRequired) {
            await serviceModules.rebuilder.$fetchLocal();
        }
        Logger($msg("TweakMismatchResolve.Message.mineUpdated"), LOG_LEVEL_NOTICE);
        return "CHECKAGAIN";
    }
    return "IGNORE";
};

export const fetchRemotePreferredTweakValuesHandler = async (
    host: MismatchedTweaksResolverHost,
    trialSetting: RemoteDBSettings
): Promise<TweakValues | false> => {
    const { services } = host;
    const replicator = await services.replicator.getNewReplicator(trialSetting);
    if (!replicator) {
        Logger("The remote type is not supported for fetching preferred tweak values.", LOG_LEVEL_NOTICE);
        return false;
    }
    if (await replicator.tryConnectRemote(trialSetting)) {
        const preferred = await replicator.getRemotePreferredTweakValues(trialSetting);
        if (preferred) {
            return preferred;
        }
        Logger("Failed to get the preferred tweak values from the remote server.", LOG_LEVEL_NOTICE);
        return false;
    }
    Logger("Failed to connect to the remote server.", LOG_LEVEL_NOTICE);
    return false;
};

export const checkAndAskUseRemoteConfigurationHandler = async (
    host: MismatchedTweaksResolverHost,
    trialSetting: RemoteDBSettings
): Promise<{ result: false | TweakValues; requireFetch: boolean }> => {
    const { services } = host;
    if (trialSetting.remoteType === REMOTE_P2P) {
        return { result: false, requireFetch: false };
    }
    const preferred = await services.tweakValue.fetchRemotePreferred(trialSetting);
    if (preferred) {
        return await services.tweakValue.askUseRemoteConfiguration(trialSetting, preferred);
    }
    return { result: false, requireFetch: false };
};

export const askUseRemoteConfigurationHandler = async (
    host: MismatchedTweaksResolverHost,
    state: { hasNotifiedAutoAcceptCompatibleUndefined: boolean },
    trialSetting: RemoteDBSettings,
    preferred: TweakValues
): Promise<{ result: false | TweakValues; requireFetch: boolean }> => {
    const { services } = host;
    const localTweaks = extractObject(TweakValuesTemplate, services.setting.settings) as TweakValues;
    const mismatchedKeys = collectMismatchedTweakKeys(localTweaks, preferred);
    const autoAcceptSide = await shouldAutoAcceptCompatibleLossy(host, state, localTweaks, preferred, mismatchedKeys);
    if (autoAcceptSide === "REMOTE") {
        return { result: { ...trialSetting, ...preferred }, requireFetch: false };
    }
    if (autoAcceptSide === "CURRENT") {
        return { result: false, requireFetch: false };
    }

    const items = Object.entries(TweakValuesShouldMatchedTemplate);
    let rebuildRequired = false;
    let rebuildRecommended = false;
    let differenceCount = 0;
    const tableRows = [] as string[];
    for (const v of items) {
        const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
        const remoteValueForDisplay = escapeMarkdownValue(valueToString(preferred[key]));
        const currentValueForDisplay = escapeMarkdownValue(valueToString((trialSetting as TweakValues)?.[key]));
        if ((trialSetting as TweakValues)?.[key] !== preferred[key]) {
            if (IncompatibleChanges.indexOf(key) !== -1) {
                rebuildRequired = true;
            }
            for (const pattern of IncompatibleChangesInSpecificPattern) {
                if (pattern.key !== key) continue;
                const isFromConditionMet =
                    "from" in pattern ? pattern.from === (trialSetting as TweakValues)?.[key] : false;
                const isToConditionMet = "to" in pattern ? pattern.to === preferred[key] : false;
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
        Logger("The settings in the remote database are the same as the local database.", LOG_LEVEL_NOTICE);
        return { result: false, requireFetch: false };
    }
    const additionalMessage =
        rebuildRequired && services.setting.settings.isConfigured
            ? $msg("TweakMismatchResolve.Message.UseRemote.WarningRebuildRequired")
            : "";
    const additionalMessage2 =
        rebuildRecommended && services.setting.settings.isConfigured
            ? $msg("TweakMismatchResolve.Message.UseRemote.WarningRebuildRecommended")
            : "";

    const table = $msg("TweakMismatchResolve.Table", { rows: tableRows.join("\n") });

    const message = $msg("TweakMismatchResolve.Message.Main", {
        table: table,
        additionalMessage: [additionalMessage, additionalMessage2].filter((v) => v).join("\n"),
    });

    const CHOICE_USE_REMOTE = $msg("TweakMismatchResolve.Action.UseConfigured");
    const CHOICE_DISMISS = $msg("TweakMismatchResolve.Action.Dismiss");
    const CHOICES = [CHOICE_USE_REMOTE, CHOICE_DISMISS];
    const retKey = await host.services.UI?.confirm.askSelectStringDialogue(message, CHOICES, {
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
};

export function useMismatchedTweaksResolver(host: MismatchedTweaksResolverHost) {
    const { services } = host;
    const state = { hasNotifiedAutoAcceptCompatibleUndefined: false };

    services.setting.onBeforeSaveSettingData.addHandler(onBeforeSaveSettingDataHandler);
    services.tweakValue.fetchRemotePreferred.setHandler(fetchRemotePreferredTweakValuesHandler.bind(null, host));
    services.tweakValue.checkAndAskResolvingMismatched.setHandler(
        checkAndAskResolvingMismatchedTweaksHandler.bind(null, host, state)
    );
    services.tweakValue.askResolvingMismatched.setHandler(askResolvingMismatchedTweaksHandler.bind(null, host));
    services.tweakValue.checkAndAskUseRemoteConfiguration.setHandler(
        checkAndAskUseRemoteConfigurationHandler.bind(null, host)
    );
    services.tweakValue.askUseRemoteConfiguration.setHandler(askUseRemoteConfigurationHandler.bind(null, host, state));
    services.replication.checkConnectionFailure.addHandler(anyAfterConnectCheckFailedHandler.bind(null, host));
}
