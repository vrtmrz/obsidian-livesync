import { createServiceFeature } from "@lib/interfaces/ServiceModule.ts";
import { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
import { EVENT_REQUEST_OPEN_SETTING_WIZARD, EVENT_REQUEST_OPEN_SETTINGS, eventHub } from "@/common/events.ts";
import type { SettingDialogueServices, SettingDialogueModules } from "./types.ts";
import { createInitialState } from "./state.ts";
import { openSetting, openSettingWizard } from "./settingOperations.ts";

/**
 * A service feature hook that registers the plug-in setting tab and listens to settings dialogue triggers.
 */
export const useObsidianSettingDialogue = createServiceFeature<SettingDialogueServices, SettingDialogueModules, void>(
    (host) => {
        const state = createInitialState();

        const everyOnloadStart = (): Promise<boolean> => {
            const app = (host as any).app;
            const plugin = (host as any).plugin;

            state.settingTab = new ObsidianLiveSyncSettingTab(app, plugin);
            plugin.addSettingTab(state.settingTab);

            eventHub.onEvent(EVENT_REQUEST_OPEN_SETTINGS, () => openSetting(host));
            eventHub.onEvent(EVENT_REQUEST_OPEN_SETTING_WIZARD, () => {
                void openSettingWizard(host, state);
            });

            return Promise.resolve(true);
        };

        host.services.appLifecycle.onInitialise.addHandler(everyOnloadStart);
    }
);
