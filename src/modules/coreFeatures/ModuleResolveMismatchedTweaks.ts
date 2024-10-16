import { Logger, LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { extractObject } from "octagonal-wheels/object";
import { TweakValuesShouldMatchedTemplate, CompatibilityBreakingTweakValues, confName, type TweakValues } from "../../lib/src/common/types.ts";
import { escapeMarkdownValue } from "../../lib/src/common/utils.ts";
import { AbstractModule } from "../AbstractModule.ts";
import type { ICoreModule } from "../ModuleTypes.ts";

export class ModuleResolvingMismatchedTweaks extends AbstractModule implements ICoreModule {
    async $anyAfterConnectCheckFailed(): Promise<boolean | "CHECKAGAIN" | undefined> {
        if (!this.core.replicator.tweakSettingsMismatched) return false;
        const ret = await this.core.$$askResolvingMismatchedTweaks();
        if (ret == "OK") return false;
        if (ret == "CHECKAGAIN") return "CHECKAGAIN";
        if (ret == "IGNORE") return true;
    }

    async $$askResolvingMismatchedTweaks(): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
        if (!this.core.replicator.tweakSettingsMismatched) {
            return "OK";
        }
        const preferred = extractObject(TweakValuesShouldMatchedTemplate, this.core.replicator.preferredTweakValue!);
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

        const additionalMessage = rebuildRequired ? `

**Note**: We have detected that some of the values are different to make incompatible the local database with the remote database.
If you choose to use the configured values, the local database will be rebuilt, and if you choose to use the values of this device, the remote database will be rebuilt. 
Both of them takes a few minutes. Please choose after considering the situation.` : "";

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
            [CHOICE_DISMISS, false]]
        const CHOICES = Object.fromEntries(CHOICE_AND_VALUES) as Record<string, TweakValues | boolean>;
        const retKey = await this.core.confirm.confirmWithMessage("Tweaks Mismatched or Changed", message, Object.keys(CHOICES), CHOICE_DISMISS, 60);
        if (!retKey) return "IGNORE";
        const conf = CHOICES[retKey];

        if (conf === true) {
            await this.core.replicator.setPreferredRemoteTweakSettings(this.settings);
            if (rebuildRequired) {
                await this.core.rebuilder.$rebuildRemote();
            }
            Logger(`Tweak values on the remote server have been updated. Your other device will see this message.`, LOG_LEVEL_NOTICE);
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
}