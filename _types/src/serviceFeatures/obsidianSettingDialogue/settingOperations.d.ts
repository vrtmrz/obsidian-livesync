// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { SettingDialogueHost } from "./types.ts";
import type { SettingDialogueState } from "./state.ts";
/**
 * Opens the Obsidian settings panel and navigates to the Self-hosted LiveSync tab.
 *
 * @param host - The service feature host context.
 */
export declare function openSetting(host: SettingDialogueHost): void;
/**
 * Opens settings and automatically launches the minimal setup configuration wizard.
 *
 * @param host - The service feature host context.
 * @param state - The state object holding the settings tab reference.
 */
export declare function openSettingWizard(host: SettingDialogueHost, state: SettingDialogueState): Promise<void>;
