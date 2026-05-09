import { $msg, setLang } from "../../../lib/src/common/i18n.ts";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "../../../lib/src/common/rosetta.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import type { PageFunctions } from "./SettingPane.ts";
import { visibleOnly } from "./SettingPane.ts";
import { EVENT_ON_UNRESOLVED_ERROR, eventHub } from "@/common/events.ts";
import { NetworkWarningStyles } from "@lib/common/models/setting.const.ts";

type NamedLanguage = Exclude<I18N_LANGS, "">;

// Language choices should be readable before the selected locale is active.
const LANGUAGE_NAMES: Record<NamedLanguage, string> = {
    def: "English",
    de: "Deutsch",
    es: "Español",
    fr: "Français",
    ja: "日本語",
    ko: "한국어",
    ru: "Русский",
    zh: "简体中文",
    "zh-tw": "繁體中文",
};

export function paneGeneral(
    this: ObsidianLiveSyncSettingTab,
    paneEl: HTMLElement,
    { addPanel, addPane }: PageFunctions
): void {
    void addPanel(paneEl, $msg("obsidianLiveSyncSettingTab.titleAppearance")).then((paneEl) => {
        const languages = Object.fromEntries([
            ["", $msg("obsidianLiveSyncSettingTab.defaultLanguage")],
            ...SUPPORTED_I18N_LANGS.map((e) => [e, LANGUAGE_NAMES[e as NamedLanguage]]),
        ]) as Record<I18N_LANGS, string>;
        new Setting(paneEl).autoWireDropDown("displayLanguage", {
            options: languages,
        });
        this.addOnSaved("displayLanguage", (value) => {
            // Apply the locale before rebuilding the pane so labels refresh immediately.
            setLang(value as I18N_LANGS);
            this.display();
        });
        new Setting(paneEl).autoWireToggle("showStatusOnEditor");
        this.addOnSaved("showStatusOnEditor", () => {
            eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
        });
        new Setting(paneEl).autoWireToggle("showOnlyIconsOnEditor", {
            onUpdate: visibleOnly(() => this.isConfiguredAs("showStatusOnEditor", true)),
        });
        new Setting(paneEl).autoWireToggle("showStatusOnStatusbar");
        new Setting(paneEl).autoWireToggle("hideFileWarningNotice");
        new Setting(paneEl).autoWireDropDown("networkWarningStyle", {
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
