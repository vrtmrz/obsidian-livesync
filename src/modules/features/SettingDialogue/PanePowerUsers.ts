import { $msg } from "../../../lib/src/common/i18n.ts";
import { type ConfigPassphraseStore } from "../../../lib/src/common/types.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";

export function panePowerUsers(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    void addPanel(paneEl, $msg("Ui.Settings.PowerUsers.ConnectionTweak"), undefined, this.onlyOnCouchDB).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        this.createEl(
            paneEl,
            "div",
            {
                text: $msg("Ui.Settings.PowerUsers.ConnectionTweakDesc"),
            },
            undefined,
            this.onlyOnCouchDB
        ).addClass("wizardHidden");

        new Setting(paneEl)
            .setClass("wizardHidden")
            .autoWireNumeric("batch_size", { clampMin: 2, onUpdate: this.onlyOnCouchDB });
        new Setting(paneEl).setClass("wizardHidden").autoWireNumeric("batches_limit", {
            clampMin: 2,
            onUpdate: this.onlyOnCouchDB,
        });
        new Setting(paneEl).setClass("wizardHidden").autoWireToggle("useTimeouts", { onUpdate: this.onlyOnCouchDB });
    });
    void addPanel(paneEl, $msg("Ui.Settings.PowerUsers.ConfigurationEncryption")).then((paneEl) => {
        const passphrase_options: Record<ConfigPassphraseStore, string> = {
            "": $msg("Ui.Settings.PowerUsers.Default"),
            LOCALSTORAGE: $msg("Ui.Settings.PowerUsers.UseCustomPassphrase"),
            ASK_AT_LAUNCH: $msg("Ui.Settings.PowerUsers.PromptPassphraseEveryLaunch"),
        };

        new Setting(paneEl)
            .setName($msg("Ui.Settings.PowerUsers.EncryptSensitiveConfig"))
            .autoWireDropDown("configPassphraseStore", {
                options: passphrase_options,
                holdValue: true,
            })
            .setClass("wizardHidden");

        new Setting(paneEl)
            .autoWireText("configPassphrase", { isPassword: true, holdValue: true })
            .setClass("wizardHidden")
            .addOnUpdate(() => ({
                disabled: !this.isConfiguredAs("configPassphraseStore", "LOCALSTORAGE"),
            }));
        new Setting(paneEl).addApplyButton(["configPassphrase", "configPassphraseStore"]).setClass("wizardHidden");
    });
    void addPanel(paneEl, $msg("Ui.Settings.PowerUsers.Developer")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("enableDebugTools").setClass("wizardHidden");
    });
}
