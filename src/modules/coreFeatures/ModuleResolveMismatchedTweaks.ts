import { Logger, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { extractObject } from "octagonal-wheels/object";
import {
    TweakValuesShouldMatchedTemplate,
    CompatibilityBreakingTweakValues,
    confName,
    type TweakValues,
    type RemoteDBSettings,
} from "../../lib/src/common/types.ts";
import { escapeMarkdownValue } from "../../lib/src/common/utils.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleResolvingMismatchedTweaks extends AbstractModule implements ICoreModule {
    async $anyAfterConnectCheckFailed(): Promise<boolean | "CHECKAGAIN" | undefined> {
        if (!this.core.replicator.tweakSettingsMismatched && !this.core.replicator.preferredTweakValue) return false;
        const preferred = this.core.replicator.preferredTweakValue;
        if (!preferred) return false;
        const ret = await this.core.$$askResolvingMismatchedTweaks(preferred);
        if (ret == "OK") return false;
        if (ret == "CHECKAGAIN") return "CHECKAGAIN";
        if (ret == "IGNORE") return true;
    }

    async $$checkAndAskResolvingMismatchedTweaks(
        preferred: Partial<TweakValues>
    ): Promise<[TweakValues | boolean, boolean]> {
        const mine = extractObject(TweakValuesShouldMatchedTemplate, this.settings);
        const items = Object.entries(TweakValuesShouldMatchedTemplate);
        let rebuildRequired = false;

        // Making tables:
        let table = `| Value name | This device | Configured | \n` + `|: --- |: --- :|: ---- :| \n`;

        // const items = [mine,preferred]
        for (const v of items) {
            const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
            const valueMine = escapeMarkdownValue(mine[key]);
            const valuePreferred = escapeMarkdownValue(preferred[key]);
            if (valueMine == valuePreferred) continue;
            if (CompatibilityBreakingTweakValues.indexOf(key) !== -1) {
                rebuildRequired = true;
            }
            table += `| ${confName(key)} | ${valueMine} | ${valuePreferred} | \n`;
        }

        const additionalMessage = rebuildRequired
            ? `

**Note**: We have detected that some of the values are different to make incompatible the local database with the remote database.
If you choose to use the configured values, the local database will be rebuilt, and if you choose to use the values of this device, the remote database will be rebuilt. 
Both of them takes a few minutes. Please choose after considering the situation.`
            : "";

        const message = `
Your configuration has not been matched with the one on the remote server.
(Which you had decided once before, or set by initially synchronised device).

Configured values:

${table}

Please select which one you want to use.

- Use configured: Update settings of this device by configured one on the remote server.
  You should select this if you have changed the settings on ** another device **.
- Update with mine: Update settings on the remote server by the settings of this device.
  You should select this if you have changed the settings on ** this device **.
- Dismiss: Ignore this message and keep the current settings.
  You cannot synchronise until you resolve this issue without enabling \`Do not check configuration mismatch before replication\`.${additionalMessage}`;

        const CHOICE_USE_REMOTE = "Use configured";
        const CHOICE_USR_MINE = "Update with mine";
        const CHOICE_DISMISS = "Dismiss";
        const CHOICE_AND_VALUES = [
            [CHOICE_USE_REMOTE, preferred],
            [CHOICE_USR_MINE, true],
            [CHOICE_DISMISS, false],
        ];
        const CHOICES = Object.fromEntries(CHOICE_AND_VALUES) as Record<string, TweakValues | boolean>;
        const retKey = await this.core.confirm.confirmWithMessage(
            "Tweaks Mismatched or Changed",
            message,
            Object.keys(CHOICES),
            CHOICE_DISMISS,
            60
        );
        if (!retKey) return [false, false];
        return [CHOICES[retKey], rebuildRequired];
    }

    async $$askResolvingMismatchedTweaks(): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
        if (!this.core.replicator.tweakSettingsMismatched) {
            return "OK";
        }
        const tweaks = this.core.replicator.preferredTweakValue;
        if (!tweaks) {
            return "IGNORE";
        }
        const preferred = extractObject(TweakValuesShouldMatchedTemplate, tweaks);

        const [conf, rebuildRequired] = await this.core.$$checkAndAskResolvingMismatchedTweaks(preferred);
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
            await this.core.$$saveSettingData();
            if (rebuildRequired) {
                await this.core.rebuilder.$fetchLocal();
            }
            Logger(`Configuration has been updated as configured by the other device.`, LOG_LEVEL_NOTICE);
            return "CHECKAGAIN";
        }
        return "IGNORE";
    }

    async $$checkAndAskUseRemoteConfiguration(
        trialSetting: RemoteDBSettings
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        const replicator = await this.core.$anyNewReplicator(trialSetting);
        if (await replicator.tryConnectRemote(trialSetting)) {
            const preferred = await replicator.getRemotePreferredTweakValues(trialSetting);
            if (preferred) {
                return await this.$$askUseRemoteConfiguration(trialSetting, preferred);
            } else {
                this._log("Failed to get the preferred tweak values from the remote server.", LOG_LEVEL_NOTICE);
            }
            return { result: false, requireFetch: false };
        } else {
            this._log("Failed to connect to the remote server.", LOG_LEVEL_NOTICE);
            return { result: false, requireFetch: false };
        }
    }
    async $$askUseRemoteConfiguration(
        trialSetting: RemoteDBSettings,
        preferred: TweakValues
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        const items = Object.entries(TweakValuesShouldMatchedTemplate);
        let rebuildRequired = false;
        // Making tables:
        let table = `| Value name | This device | Stored | \n` + `|: --- |: ---- :|: ---- :| \n`;
        let differenceCount = 0;
        // const items = [mine,preferred]
        for (const v of items) {
            const key = v[0] as keyof typeof TweakValuesShouldMatchedTemplate;
            const valuePreferred = escapeMarkdownValue(preferred[key]);
            const currentDisp = `${escapeMarkdownValue((trialSetting as TweakValues)?.[key])} |`;
            if ((trialSetting as TweakValues)?.[key] !== preferred[key]) {
                if (CompatibilityBreakingTweakValues.indexOf(key) !== -1) {
                    rebuildRequired = true;
                }
            } else {
                continue;
            }
            table += `| ${confName(key)} | ${currentDisp} ${valuePreferred} | \n`;
            differenceCount++;
        }

        if (differenceCount === 0) {
            this._log("The settings in the remote database are the same as the local database.", LOG_LEVEL_NOTICE);
            return { result: false, requireFetch: false };
        }
        const additionalMessage =
            rebuildRequired && this.core.settings.isConfigured
                ? `

>[!WARNING]
> Some remote configurations are not compatible with the local database of this device. Rebuilding the local database will be required.
***Please ensure that you have time and are connected to a stable network to apply!***`
                : "";

        const message = `
The settings in the remote database are as follows.
If you want to use these settings, please select "Use configured".
If you want to keep the settings of this device, please select "Dismiss".

${table}

>[!TIP]
> If you want to synchronise all settings, please use \`Sync settings via markdown\` after applying minimal configuration with this feature.

${additionalMessage}`;

        const CHOICE_USE_REMOTE = "Use configured";
        const CHOICE_DISMISS = "Dismiss";
        // const CHOICE_AND_VALUES = [
        //     [CHOICE_USE_REMOTE, preferred],
        //     [CHOICE_DISMISS, false]]
        const CHOICES = [CHOICE_USE_REMOTE, CHOICE_DISMISS];
        const retKey = await this.core.confirm.askSelectStringDialogue(message, CHOICES, {
            title: "Use Remote Configuration",
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
}
