import { $msg, $t } from "../../../lib/src/common/i18n.ts";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "../../../lib/src/common/rosetta.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
export function paneGeneral(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleAppearance")).then((paneEl) => {
        const languages = Object.fromEntries([
            // ["", $msg("obsidianLiveSyncSettingTab.defaultLanguage")],
            ...SUPPORTED_I18N_LANGS.map((e) => [e, $t(`lang-${e}`)]),
        ]) as Record<I18N_LANGS, string>;
        new Setting(paneEl).autoWireDropDown("displayLanguage", {
            options: languages,
        });
        this.addOnSaved("displayLanguage", () => this.display());
        new Setting(paneEl).autoWireToggle("showStatusOnEditor");
        new Setting(paneEl).autoWireToggle("showOnlyIconsOnEditor", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("showStatusOnEditor", true)),
        });
        new Setting(paneEl).autoWireToggle("showStatusOnStatusbar");
        new Setting(paneEl).autoWireToggle("hideFileWarningNotice");
    });
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleLogging")).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        new Setting(paneEl).autoWireToggle("lessInformationInLog");

        new Setting(paneEl).autoWireToggle("showVerboseLog", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("lessInformationInLog", false)),
        });
    });
    new Setting(paneEl).setClass("wizardOnly").addButton((button) =>
        button
            .setButtonText($msg("obsidianLiveSyncSettingTab.btnNext"))
            .setCta()
            .onClick(() => {
                this.changeDisplay("0");
            })
    );
}
