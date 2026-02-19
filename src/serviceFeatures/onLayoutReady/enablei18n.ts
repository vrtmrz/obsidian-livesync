import { getLanguage } from "@/deps";
import { createServiceFeature } from "../types.ts";
import { SUPPORTED_I18N_LANGS, type I18N_LANGS } from "@lib/common/rosetta";
import { $msg, setLang } from "@lib/common/i18n";

export const enableI18nFeature = createServiceFeature(async ({ services: { setting, API } }) => {
    let isChanged = false;
    const settings = setting.currentSettings();
    if (settings.displayLanguage == "") {
        const obsidianLanguage = getLanguage();
        if (
            SUPPORTED_I18N_LANGS.indexOf(obsidianLanguage) !== -1 && // Check if the language is supported
            obsidianLanguage != settings.displayLanguage // Check if the language is different from the current setting
        ) {
            // Check if the current setting is not empty (Means migrated or installed).
            // settings.displayLanguage = obsidianLanguage as I18N_LANGS;
            await setting.applyPartial({ displayLanguage: obsidianLanguage as I18N_LANGS });
            isChanged = true;
            setLang(settings.displayLanguage);
        } else if (settings.displayLanguage == "") {
            // settings.displayLanguage = "def";
            await setting.applyPartial({ displayLanguage: "def" });
            setLang(settings.displayLanguage);
            await setting.saveSettingData();
        }
    }
    if (isChanged) {
        const revert = $msg("dialog.yourLanguageAvailable.btnRevertToDefault");
        if (
            (await API.confirm.askSelectStringDialogue($msg(`dialog.yourLanguageAvailable`), ["OK", revert], {
                defaultAction: "OK",
                title: $msg(`dialog.yourLanguageAvailable.Title`),
            })) == revert
        ) {
            await setting.applyPartial({ displayLanguage: "def" });
            setLang(settings.displayLanguage);
        }
        await setting.saveSettingData();
    }
    return true;
});
