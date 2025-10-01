import { $msg, $t } from "@/lib/src/common/i18n";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { PageFunctions, visibleOnly } from "./SettingPane";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "@/lib/src/common/rosetta";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting";

export function pageGeneral(
    this: ObsidianLiveSyncSettingTab,
    pageEl: HTMLElement,
    { addPanel } : PageFunctions
) : void {
    // Appearance
    void addPanel(
        pageEl,
        $msg("obsidianLiveSyncSettingTab.titleAppearance")).then((pageEl) => {
            // Get supported languages
            const languages = Object.fromEntries([
                ...SUPPORTED_I18N_LANGS.map((e) => [e, $t(`lang-${e}`)]),
            ]) as Record<I18N_LANGS, string>;

            // Display Language
            new Setting(pageEl).autoWireDropDown("displayLanguage", {
                options: languages
            });
            this.addOnSaved("displayLanguage", () => this.display());

            // Show Status in Editor
            new Setting(pageEl).autoWireToggle("showStatusOnEditor");

            // Show Status on Status Bar
            new Setting(pageEl).autoWireToggle("showOnlyIconsOnEditor", {
                onUpdate: visibleOnly(() => this.isConfiguredAs("showStatusOnEditor", true)),
            });

            // Use Status Icon instead of Banner
            new Setting(pageEl).autoWireToggle("showStatusOnStatusbar");
        });

    // Logging
    void addPanel(
        pageEl,
        $msg("obsidianLiveSyncSettingTab.titleLogging")).then((pageEl) => {
            new Setting(pageEl).autoWireToggle("lessInformationInLog");

            new Setting(pageEl).autoWireToggle("showVerboseLog", {
                onUpdate: visibleOnly(() => this.isConfiguredAs("lessInformationInLog", false)),
            });
        });
};