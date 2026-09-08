import { Logger, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { extractObject } from "octagonal-wheels/object";
import {
    TweakValuesTemplate,
    configurationNames,
    statusDisplay,
    type TweakValues,
    type ObsidianLiveSyncSettings,
    type RemoteDBSettings,
    type RemotePreferredTweakResult,
    RemotePreferredTweakStatuses,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { assessTweakCompatibility, type TweakAssessment } from "@vrtmrz/livesync-commonlib/settings";
import { escapeMarkdownValue } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import { AbstractModule } from "@/modules/AbstractModule.ts";
import { $msg, translateIfAvailable } from "@/common/translation";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import type { LiveSyncCore } from "@/main.ts";
import { REMOTE_P2P } from "@vrtmrz/livesync-commonlib/compat/common/models/setting.const";
import { withOwnedRemoteResource } from "@/common/ownedRemoteResource";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    REMOTE_RESOURCE_KINDS,
    type ReplicationAttemptFailure,
    type ReplicatorInstance,
} from "@vrtmrz/livesync-commonlib/replication";

interface PreferredRemoteTweakWriter extends ReplicatorInstance {
    setPreferredRemoteTweakSettings(setting: ObsidianLiveSyncSettings): Promise<void>;
}

function canSetPreferredRemoteTweakSettings(replicator: ReplicatorInstance): replicator is PreferredRemoteTweakWriter {
    return (
        "setPreferredRemoteTweakSettings" in replicator &&
        typeof replicator.setPreferredRemoteTweakSettings === "function"
    );
}

/**
 * Localised counterpart of Commonlib's `confName()`, which takes no translator.
 * Same shape: label plus status suffix, and an empty string for an unknown key.
 */
function localisedConfName(key: keyof ObsidianLiveSyncSettings): string {
    const info = configurationNames[key];
    if (!info) return "";
    return `${translateIfAvailable(info.name)}${statusDisplay(info.status)}`;
}

function valueToString(value: string | number | boolean | object | undefined): string {
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return `${value}`;
}

function definedTweaks(values: TweakValues): TweakValues {
    return Object.fromEntries(
        Object.entries(values).filter(([key, value]) => key in TweakValuesTemplate && value !== undefined)
    );
}

function settingsAfterAdoption(assessment: TweakAssessment, direction: "adoptPreferred" | "adoptCurrent"): TweakValues {
    const comparedKeys = new Set<string>(assessment.entries.map((entry) => entry.key));
    const source = direction === "adoptPreferred" ? assessment.preferredValues : assessment.currentValues;
    const target = direction === "adoptPreferred" ? assessment.currentValues : assessment.preferredValues;
    const recommendations = Object.fromEntries(
        Object.entries(source).filter(([key, value]) => !comparedKeys.has(key) && value !== undefined)
    );
    return {
        ...definedTweaks(target),
        ...recommendations,
        ...assessment[direction].changes,
    };
}

function mismatchTable(assessment: TweakAssessment, direction?: "adoptPreferred" | "adoptCurrent"): string {
    const reasons = direction
        ? assessment[direction].reasons
        : [...assessment.adoptPreferred.reasons, ...assessment.adoptCurrent.reasons];
    const consequenceKeys = new Set(reasons.map((reason) => reason.key));
    const rows = assessment.entries
        .filter((entry) => entry.relation === "different" || consequenceKeys.has(entry.key))
        .map((entry) =>
            $msg("TweakMismatchResolve.Table.Row", {
                name: localisedConfName(entry.key),
                self: valueToString(escapeMarkdownValue(entry.current.effectiveValue)),
                remote: valueToString(escapeMarkdownValue(entry.preferred.effectiveValue)),
            })
        );
    return $msg("TweakMismatchResolve.Table", { rows: rows.join("\n") });
}

/** Kept only while resolving a decision; this can contain credentials and must never be logged. */
function resolutionSettingsSignature(settings: ObsidianLiveSyncSettings): string {
    return JSON.stringify({ ...settings, autoAcceptCompatibleTweak: settings.autoAcceptCompatibleTweak ?? true });
}

export class ModuleResolvingMismatchedTweaks extends AbstractModule {
    private _selectNewerTweakSide(current: TweakValues, preferred: Partial<TweakValues>): "REMOTE" | "CURRENT" {
        Logger(`Modified: ${current.tweakModified} (current) vs ${preferred.tweakModified} (preferred)`);
        const currentModified = current.tweakModified;
        const preferredModified = preferred.tweakModified;
        // debugger;
        const hasCurrentModified = typeof currentModified === "number" && currentModified > 0;
        const hasPreferredModified = typeof preferredModified === "number" && preferredModified > 0;

        if (!hasCurrentModified && !hasPreferredModified) return "REMOTE";
        if (!hasCurrentModified) return "REMOTE";
        if (!hasPreferredModified) return "CURRENT";
        if (preferredModified >= currentModified) return "REMOTE";
        return "CURRENT";
    }

    private async _shouldAutoAcceptCompatibleLossy(
        assessment: TweakAssessment
    ): Promise<"REMOTE" | "CURRENT" | undefined> {
        if (!assessment.onlyCompatibleLossyDifferences) return undefined;

        let autoAcceptCompatibleTweak = this.settings.autoAcceptCompatibleTweak;
        if (this.settings.autoAcceptCompatibleTweak === undefined) {
            // Keep the settings object stable: settings panes and an in-flight replication retry can
            // retain this reference while the default is persisted.
            this.settings.autoAcceptCompatibleTweak = true;
            await this.services.setting.saveSettingData();
            autoAcceptCompatibleTweak = true;
            Logger("Automatic alignment of compatible chunk settings has been enabled.");
        }

        if (autoAcceptCompatibleTweak !== true) return undefined;
        return this._selectNewerTweakSide(assessment.currentValues, assessment.preferredValues);
    }

    /**
     * Hook before saving settings, to check if there are changes in tweak values, and if so,
     * update the tweakModified timestamp to current time.
     * This allows other devices to know that the tweak values have been changed and decide whether to accept the new values based on the modification time.
     * @param next
     * @param previous
     * @returns
     */
    async _onBeforeSaveSettingData(next: ObsidianLiveSyncSettings, previous: ObsidianLiveSyncSettings) {
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
    }

    async _anyAfterConnectCheckFailed(failure: ReplicationAttemptFailure): Promise<boolean | "CHECKAGAIN" | undefined> {
        const recovery = failure.outcome.recoveryHint;
        if (
            recovery?.reason !== CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH ||
            !recovery.preferredTweakValue
        ) {
            return false;
        }
        const isCurrent = await this.services.replicator.runWithActiveReplicatorContext(
            (activeContext) => activeContext === failure.context
        );
        if (!isCurrent || resolutionSettingsSignature(failure.setting) !== resolutionSettingsSignature(this.settings)) {
            return true;
        }
        const assessment =
            recovery.tweakAssessment ?? assessTweakCompatibility(failure.setting, recovery.preferredTweakValue);
        const ret = await this.services.tweakValue.askResolvingMismatched(
            { ...recovery.preferredTweakValue },
            async (setting) => {
                let updated = false;
                await this.services.replicator.runWithActiveReplicatorContext(async (activeContext) => {
                    if (activeContext !== failure.context) return;
                    if (!canSetPreferredRemoteTweakSettings(activeContext.replicator)) return;
                    await activeContext.replicator.setPreferredRemoteTweakSettings({ ...setting });
                    updated = true;
                });
                return updated;
            },
            assessment
        );
        if (ret == "OK") return false;
        if (ret == "CHECKAGAIN") return "CHECKAGAIN";
        if (ret == "IGNORE") return true;
    }

    async _checkAndAskResolvingMismatchedTweaks(
        preferred: TweakValues,
        assessment = assessTweakCompatibility(this.settings, preferred)
    ): Promise<[TweakValues | boolean, boolean]> {
        if (assessment.alignment === "matched") return [false, false];
        const acceptedSettings = settingsAfterAdoption(assessment, "adoptPreferred");
        const autoAcceptSide = await this._shouldAutoAcceptCompatibleLossy(assessment);
        if (autoAcceptSide === "REMOTE") return [acceptedSettings, false];
        if (autoAcceptSide === "CURRENT") return [true, false];

        const localImpact = assessment.adoptPreferred.reconstruction;
        const remoteImpact = assessment.adoptCurrent.reconstruction;
        const requiresRebuild = localImpact === "required" || remoteImpact === "required";
        const recommendsRebuild = localImpact === "recommended" || remoteImpact === "recommended";
        const additionalMessage =
            requiresRebuild && this.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.WarningIncompatibleRebuildRequired")
                : "";
        const additionalMessage2 =
            recommendsRebuild && this.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.WarningIncompatibleRebuildRecommended")
                : "";
        const message = $msg("TweakMismatchResolve.Message.MainTweakResolving", {
            table: mismatchTable(assessment),
            additionalMessage: [additionalMessage, additionalMessage2].filter(Boolean).join("\n"),
        });
        const choices: Record<string, [TweakValues | boolean, boolean]> = {};
        const remoteChoices = {
            ordinary: $msg("TweakMismatchResolve.Action.UseRemote"),
            rebuild: $msg("TweakMismatchResolve.Action.UseRemoteWithRebuild"),
            accept: $msg("TweakMismatchResolve.Action.UseRemoteAcceptIncompatible"),
        };
        const localChoices = {
            ordinary: $msg("TweakMismatchResolve.Action.UseMine"),
            rebuild: $msg("TweakMismatchResolve.Action.UseMineWithRebuild"),
            accept: $msg("TweakMismatchResolve.Action.UseMineAcceptIncompatible"),
        };
        // Each direction owns its consequence; a rebuild on one side does not require one on the other.
        choices[localImpact === "required" ? remoteChoices.rebuild : remoteChoices.ordinary] = [
            acceptedSettings,
            localImpact === "required",
        ];
        choices[remoteImpact === "required" ? localChoices.rebuild : localChoices.ordinary] = [
            true,
            remoteImpact === "required",
        ];
        if (localImpact !== "none") {
            choices[localImpact === "required" ? remoteChoices.accept : remoteChoices.rebuild] = [
                acceptedSettings,
                localImpact !== "required",
            ];
        }
        if (remoteImpact !== "none") {
            choices[remoteImpact === "required" ? localChoices.accept : localChoices.rebuild] = [
                true,
                remoteImpact !== "required",
            ];
        }
        const dismiss = $msg("TweakMismatchResolve.Action.Dismiss");
        choices[dismiss] = [false, false];
        const retKey = await this.core.confirm.askSelectStringDialogue(message, Object.keys(choices), {
            title: $msg("TweakMismatchResolve.Title.TweakResolving"),
            timeout: 60,
            defaultAction: dismiss,
        });
        return (retKey && choices[retKey]) || [false, false];
    }

    async _askResolvingMismatchedTweaks(
        preferredSource: TweakValues,
        updatePreferredRemote?: (setting: ObsidianLiveSyncSettings) => Promise<boolean>,
        assessment = assessTweakCompatibility(this.settings, preferredSource)
    ): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
        const signature = resolutionSettingsSignature(this.settings);
        const publication = await this.services.replicator.acquireActiveReplicatorContext();
        if (resolutionSettingsSignature(this.settings) !== signature) return "IGNORE";
        const currentTweaks = JSON.stringify(extractObject(TweakValuesTemplate, this.settings));
        if (JSON.stringify(extractObject(TweakValuesTemplate, assessment.currentValues)) !== currentTweaks) {
            return "IGNORE";
        }
        const [conf, rebuildRequired] = await this.services.tweakValue.checkAndAskResolvingMismatched(
            preferredSource,
            assessment
        );
        if (!conf) return "IGNORE";
        const currentPublication = await this.services.replicator.acquireActiveReplicatorContext();
        if (currentPublication !== publication || resolutionSettingsSignature(this.settings) !== signature) {
            return "IGNORE";
        }

        const updateRemote = async (tweaks: TweakValues) => {
            const setting = {
                ...this.settings,
                ...definedTweaks(assessment.preferredValues),
                ...definedTweaks(tweaks),
            };
            if (updatePreferredRemote) return await updatePreferredRemote(setting);
            const candidate = this.core.replicator;
            if (typeof candidate.setPreferredRemoteTweakSettings !== "function") return false;
            await candidate.setPreferredRemoteTweakSettings(setting);
            return true;
        };

        if (conf === true) {
            if (!(await updateRemote(settingsAfterAdoption(assessment, "adoptCurrent")))) return "IGNORE";
            if (rebuildRequired) {
                await this.core.rebuilder.$rebuildRemote();
            }
            Logger($msg("TweakMismatchResolve.Message.remoteUpdated"), LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        if (conf) {
            // Keep existing consumers' settings reference stable, and never erase a value omitted by an older peer.
            Object.assign(this.settings, definedTweaks(conf));
            await this.services.setting.saveSettingData();
            if (!rebuildRequired) {
                // The failed replication has settled before mismatch resolution runs. Reinitialise the
                // chunk-generation managers now so hash and splitter changes take effect before retrying.
                await this.localDatabase.managers.reinitialise();
            }
            if (!(await updateRemote(this.settings))) return "IGNORE";
            if (rebuildRequired) {
                await this.core.rebuilder.$fetchLocal();
            }
            Logger($msg("TweakMismatchResolve.Message.mineUpdated"), LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        return "IGNORE";
    }

    async _fetchRemotePreferredTweakValues(trialSetting: RemoteDBSettings): Promise<RemotePreferredTweakResult> {
        try {
            const probe = await this.services.replicator.createRemoteResource(
                REMOTE_RESOURCE_KINDS.PREFERRED_TWEAK,
                trialSetting
            );
            if (!probe) {
                this._log("The remote type does not support preferred tweak values.", LOG_LEVEL_NOTICE);
                return { status: RemotePreferredTweakStatuses.UNSUPPORTED };
            }
            return await withOwnedRemoteResource(probe, (ownedProbe) => ownedProbe.read());
        } catch (ex) {
            this._log("Failed to get the preferred tweak values from the remote.", LOG_LEVEL_NOTICE);
            return {
                status: RemotePreferredTweakStatuses.UNAVAILABLE,
                error: ex,
            };
        }
    }

    async _checkAndAskUseRemoteConfiguration(
        trialSetting: RemoteDBSettings
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        if (trialSetting.remoteType === REMOTE_P2P) {
            return { result: false, requireFetch: false };
        }
        const signature = JSON.stringify(trialSetting);
        const preferred = await this.services.tweakValue.fetchRemotePreferred(trialSetting);
        if (JSON.stringify(trialSetting) !== signature) return { result: false, requireFetch: false };
        if (preferred.status === RemotePreferredTweakStatuses.AVAILABLE) {
            return await this.services.tweakValue.askUseRemoteConfiguration(trialSetting, preferred.values);
        }
        return { result: false, requireFetch: false };
    }

    async _askUseRemoteConfiguration(
        trialSetting: RemoteDBSettings,
        preferred: TweakValues
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        const trialSignature = JSON.stringify(trialSetting);
        const currentSignature = resolutionSettingsSignature(this.settings);
        const assessment = assessTweakCompatibility(trialSetting, preferred);
        if (assessment.alignment === "matched") {
            this._log("The settings in the remote database are the same as the local database.", LOG_LEVEL_NOTICE);
            return { result: false, requireFetch: false };
        }
        const publication = await this.services.replicator.acquireActiveReplicatorContext();
        const settingsStillCurrent = () =>
            JSON.stringify(trialSetting) === trialSignature &&
            resolutionSettingsSignature(this.settings) === currentSignature;
        if (!settingsStillCurrent()) return { result: false, requireFetch: false };
        const stillCurrent = async () =>
            (await this.services.replicator.acquireActiveReplicatorContext()) === publication && settingsStillCurrent();
        const acceptedSettings = { ...trialSetting, ...settingsAfterAdoption(assessment, "adoptPreferred") };
        const autoAcceptSide = await this._shouldAutoAcceptCompatibleLossy(assessment);
        if (!(await stillCurrent())) return { result: false, requireFetch: false };
        if (autoAcceptSide === "REMOTE") return { result: acceptedSettings, requireFetch: false };
        if (autoAcceptSide === "CURRENT") return { result: false, requireFetch: false };

        const impact = assessment.adoptPreferred.reconstruction;
        const additionalMessage =
            impact === "required" && this.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.UseRemote.WarningRebuildRequired")
                : "";
        const additionalMessage2 =
            impact === "recommended" && this.settings.isConfigured
                ? $msg("TweakMismatchResolve.Message.UseRemote.WarningRebuildRecommended")
                : "";
        const message = $msg("TweakMismatchResolve.Message.Main", {
            table: mismatchTable(assessment, "adoptPreferred"),
            additionalMessage: [additionalMessage, additionalMessage2].filter(Boolean).join("\n"),
        });
        const useRemote = $msg("TweakMismatchResolve.Action.UseConfigured");
        const dismiss = $msg("TweakMismatchResolve.Action.Dismiss");
        const retKey = await this.core.confirm.askSelectStringDialogue(message, [useRemote, dismiss], {
            title: $msg("TweakMismatchResolve.Title.UseRemoteConfig"),
            timeout: 0,
            defaultAction: dismiss,
        });
        if (retKey !== useRemote || !(await stillCurrent())) return { result: false, requireFetch: false };
        return { result: acceptedSettings, requireFetch: impact === "required" };
    }

    override onBindFunction(core: LiveSyncCore, services: InjectableServiceHub): void {
        services.setting.onBeforeSaveSettingData.addHandler(this._onBeforeSaveSettingData.bind(this));
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
