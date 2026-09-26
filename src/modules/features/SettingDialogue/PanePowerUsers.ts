import { type ConfigPassphraseStore } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { $msg } from "@/common/translation";

export function panePowerUsers(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    void addPanel(paneEl, $msg("CouchDB Connection Tweak"), undefined, this.onlyOnCouchDB).then((paneEl) => {
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
        );

        new Setting(paneEl).autoWireNumeric("batch_size", { clampMin: 2, onUpdate: this.onlyOnCouchDB });
        new Setting(paneEl).autoWireNumeric("batches_limit", {
            clampMin: 2,
            onUpdate: this.onlyOnCouchDB,
        });
        new Setting(paneEl).autoWireToggle("useTimeouts", { onUpdate: this.onlyOnCouchDB });
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
            });

        new Setting(paneEl).autoWireText("configPassphrase", { isPassword: true, holdValue: true }).addOnUpdate(() => ({
            disabled: !this.isConfiguredAs("configPassphraseStore", "LOCALSTORAGE"),
        }));
        new Setting(paneEl).addApplyButton(["configPassphrase", "configPassphraseStore"]);
    });
    void addPanel(paneEl, $msg("Developer")).then((paneEl) => {
        new Setting(paneEl).autoWireToggle("enableDebugTools");
    });
}
