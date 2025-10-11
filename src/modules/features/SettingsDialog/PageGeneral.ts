import { $msg, $t } from "@/lib/src/common/i18n";
import { ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab";
import { type PageFunctions, visibleOnly } from "./SettingPane";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "@/lib/src/common/rosetta";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting";

export function pageGeneral(
    this: ObsidianLiveSyncSettingTab,
    pageEl: HTMLElement,
    { addPanel }: PageFunctions
): void {
    // Appearance
    void addPanel(
        pageEl,
        $msg("general.appearance.title")).then((pageEl) => {
            // Get supported languages
            const languages = Object.fromEntries([
                ...SUPPORTED_I18N_LANGS.map((e) => [e, $t(`lang-${e}`)]),
            ]) as Record<I18N_LANGS, string>;

            // Display Language
            new Setting(pageEl).autoWireDropDown("displayLanguage", {
                options: languages
            })
                .setName($msg("general.appearance.displayLanguage.title"))
                .setDesc($msg("general.appearance.displayLanguage.desc"));
            this.addOnSaved("displayLanguage", () => this.display());

            // Show Status in Editor
            new Setting(pageEl).autoWireToggle("showStatusOnEditor")
                .setName($msg("general.appearance.showStatusInEditor.title"))
                .setDesc($msg("general.appearance.showStatusInEditor.desc"));

            // Show Status as Icons
            new Setting(pageEl).autoWireToggle("showOnlyIconsOnEditor", {
                onUpdate: visibleOnly(() => this.isConfiguredAs("showStatusOnEditor", true)),
            })
                .setName($msg("general.appearance.showStatusAsIcons.title"))
                .setDesc($msg("general.appearance.showStatusAsIcons.desc"));

            // Show Status on Status Bar
            new Setting(pageEl).autoWireToggle("showStatusOnStatusbar")
                .setName($msg("general.appearance.showStatusInStatusBar.title"))
                .setDesc($msg("general.appearance.showStatusInStatusBar.desc"));

            // Use Status Icon instead of Banner
            new Setting(pageEl).autoWireToggle("hideFileWarningNotice")
                .setName($msg("general.appearance.useStatusIconInstead.title"))
                .setDesc($msg("general.appearance.useStatusIconInstead.desc"));
        }
        );

    // Logging
    void addPanel(
        pageEl,
        $msg("general.logging.title")).then((pageEl) => {
            pageEl.addClass("wizardHidden");

            // Only Display Notifications
            new Setting(pageEl).autoWireToggle("lessInformationInLog")
                .setName($msg("general.logging.onlyNotifications.title"))
                .setDesc($msg("general.logging.onlyNotifications.desc"));

            // Enable Verbose Logging
            new Setting(pageEl).autoWireToggle("showVerboseLog", {
                onUpdate: visibleOnly(() => this.isConfiguredAs("lessInformationInLog", false)),
            })
                .setName($msg("general.logging.verboseLogging.title"))
                .setDesc($msg("general.logging.verboseLogging.desc"));
        }
        );

    // Reset
    void addPanel(
        pageEl,
        $msg("general.reset.title")).then((pageEl) => {
            // Reset Self-hosted LiveSync Configuration
            new Setting(pageEl)
                .setName($msg("general.reset.resetClient.title"))
                .setDesc($msg("general.reset.resetClient.desc"))
                .addButton((button) =>
                    button
                        .setButtonText($msg("action.button.reset"))
                        .setDisabled(false)
                        .setWarning()
                        .onClick(async () => {
                            this.editingSettings.isConfigured = false;
                            await this.saveAllDirtySettings();
                            this.plugin.$$askReload();
                        })
                );
        }
    );

    // Wizard Next Button
    new Setting(pageEl).setClass("wizardOnly").addButton((button) =>
        button
            .setButtonText($msg("obsidianLiveSyncSettingTab.btnNext"))
            .setCta()
            .onClick(() => {
                this.changeDisplay("0");
            })
    );
};