import { createServiceFeature } from "@lib/interfaces/ServiceModule";
import { setLang } from "@lib/common/i18n";

export const enableI18nFeature = createServiceFeature(async ({ services: { setting } }) => {
    setLang(setting.currentSettings().displayLanguage);
    return true;
});

