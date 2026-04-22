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
    void addPanel(paneEl, $msg("CouchDB Connection Tweak"), undefined, this.onlyOnCouchDB).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        this.createEl(
            paneEl,
            "div",
            {
                text: $msg(
                    "If you reached the payload size limit when using IBM Cloudant, please decrease batch size and batch limit to a lower value."
                ),
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
    void addPanel(paneEl, $msg("Configuration Encryption")).then((paneEl) => {
        const passphrase_options: Record<ConfigPassphraseStore, string> = {
            "": $msg("Default"),
            LOCALSTORAGE: $msg("Use a custom passphrase"),
            ASK_AT_LAUNCH: $msg("Ask a passphrase at every launch"),
        };

        new Setting(paneEl)
            .setName($msg("Encrypting sensitive configuration items"))
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
    void addPanel(paneEl, $msg("Developer")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("enableDebugTools").setClass("wizardHidden");
    });
}
