import { getLanguage, Notice, requireApiVersion } from "@/deps";
import { createServiceFeature } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "@/common/rosetta";
import { $msg, __onMissingTranslation, setLang } from "@/common/translation";
import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";

function tryGetLanguage(onError: (error: unknown) => void) {
    if (requireApiVersion("1.8.7")) {
        try {
            return getLanguage();
        } catch (e) {
            onError(e);
        }
    }
    return "en";
}

class ObsidianLanguageAppliedNotice {
    private reminder: Notice | undefined;

    show(openDetails: () => void): void {
        this.clear();
        let reminderAnchor: HTMLAnchorElement | undefined;
        const appliedMessage =
            $msg("dialog.yourLanguageAvailable")
                .split(/\r?\n\s*\r?\n/u, 1)[0]
                ?.trim() ?? $msg("Display Language");
        const fragment = createFragment((documentFragment) => {
            documentFragment.createSpan({
                text: `${appliedMessage} `,
            });
            documentFragment.createEl("a", { text: $msg("Open the dialog") }, (anchor) => {
                reminderAnchor = anchor;
                anchor.addEventListener("click", (event) => {
                    event.preventDefault();
                    this.clear();
                    openDetails();
                });
            });
        });
        this.reminder = new Notice(fragment, 0);
        reminderAnchor?.closest<HTMLElement>(".notice")?.classList.add("livesync-language-applied-notice");
    }

    clear(): void {
        this.reminder?.hide();
        this.reminder = undefined;
    }
}

export const enableI18nFeature = createServiceFeature(async ({ services: { setting, API, appLifecycle } }) => {
    // Clear missing translation handler to avoid unnecessary warnings.
    __onMissingTranslation(() => {});
    let isChanged = false;
    const settings = setting.currentSettings();
    if (settings.displayLanguage == "") {
        const obsidianLanguage = tryGetLanguage((error) => {
            API.addLog(
                `Failed to get Obsidian language; defaulting to 'en': ${String(error)}`,
                LOG_LEVEL_VERBOSE,
                "i18n-language"
            );
        });
        if (
            SUPPORTED_I18N_LANGS.indexOf(obsidianLanguage) !== -1 && // Check if the language is supported
            obsidianLanguage != settings.displayLanguage // Check if the language is different from the current setting
        ) {
            // Check if the current setting is not empty (Means migrated or installed).
            // settings.displayLanguage = obsidianLanguage as I18N_LANGS;
            await setting.applyPartial({ displayLanguage: obsidianLanguage as I18N_LANGS });
            isChanged = true;
            setLang(obsidianLanguage as I18N_LANGS);
        } else if (settings.displayLanguage == "") {
            // settings.displayLanguage = "def";
            await setting.applyPartial({ displayLanguage: "def" });
            setLang("def");
            await setting.saveSettingData();
        }
    }
    if (isChanged) {
        await setting.saveSettingData();
        const reminder = new ObsidianLanguageAppliedNotice();
        appLifecycle.onUnload.addHandler(() => {
            reminder.clear();
            return Promise.resolve(true);
        });
        reminder.show(() => {
            void (async () => {
                try {
                    const revert = $msg("dialog.yourLanguageAvailable.btnRevertToDefault");
                    if (
                        (await API.confirm.askSelectStringDialogue(
                            $msg(`dialog.yourLanguageAvailable`),
                            ["OK", revert],
                            {
                                defaultAction: "OK",
                                title: $msg("Display Language"),
                            }
                        )) == revert
                    ) {
                        await setting.applyPartial({ displayLanguage: "def" });
                        setLang("def");
                        await setting.saveSettingData();
                    }
                } catch (error) {
                    API.addLog(
                        `Failed to open translation details: ${String(error)}`,
                        LOG_LEVEL_VERBOSE,
                        "i18n-language"
                    );
                }
            })();
        });
    }
    return true;
});
