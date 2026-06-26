import type { SettingDialogueHost } from "./types.ts";
import type { SettingDialogueState } from "./state.ts";

/**
 * Opens the Obsidian settings panel and navigates to the Self-hosted LiveSync tab.
 *
 * @param host - The service feature host context.
 */
export function openSetting(host: SettingDialogueHost): void {
    const app = host.context.app as any;
    if (app?.setting) {
        try {
            app.setting.open();
            app.setting.openTabById("obsidian-livesync");
        } catch {
            // Ignore potential errors from undocumented APIs in test/headless environments
        }
    }
}

/**
 * Opens settings and automatically launches the minimal setup configuration wizard.
 *
 * @param host - The service feature host context.
 * @param state - The state object holding the settings tab reference.
 */
export async function openSettingWizard(host: SettingDialogueHost, state: SettingDialogueState): Promise<void> {
    openSetting(host);
    if (state.settingTab) {
        await state.settingTab.enableMinimalSetup();
    }
}
