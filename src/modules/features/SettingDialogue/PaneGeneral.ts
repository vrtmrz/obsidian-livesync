import { $msg, $t } from "@lib/common/i18n.ts";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "@lib/common/rosetta.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import { renderObsidianSetting } from "./ObsidianSettingRenderer.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { EVENT_ON_UNRESOLVED_ERROR, eventHub } from "@/common/events.ts";
import { NetworkWarningStyles } from "@lib/common/models/setting.const.ts";
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
        renderObsidianSetting(paneEl, "displayLanguage", {
            options: languages,
        });
        this.addOnSaved("displayLanguage", () => this.display());
        renderObsidianSetting(paneEl, "showStatusOnEditor");
        this.addOnSaved("showStatusOnEditor", () => {
            eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
        });
        renderObsidianSetting(paneEl, "showOnlyIconsOnEditor", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("showStatusOnEditor", true)),
        });
        renderObsidianSetting(paneEl, "showStatusOnStatusbar");
        renderObsidianSetting(paneEl, "hideFileWarningNotice");
        renderObsidianSetting(paneEl, "networkWarningStyle", {
            options: {
                [NetworkWarningStyles.BANNER]: "Show full banner",
                [NetworkWarningStyles.ICON]: "Show icon only",
                [NetworkWarningStyles.HIDDEN]: "Hide completely",
            },
        });
        this.addOnSaved("networkWarningStyle", () => {
            eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
        });
    });
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleLogging")).then((paneEl) => {
        paneEl.addClass("wizardHidden");

        renderObsidianSetting(paneEl, "lessInformationInLog");

        renderObsidianSetting(paneEl, "showVerboseLog", {
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
