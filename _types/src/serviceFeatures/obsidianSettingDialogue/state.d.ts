// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { ObsidianLiveSyncSettingTab } from "@/modules/features/SettingDialogue/ObsidianLiveSyncSettingTab.ts";
/**
 * Interface representing the internal state of the setting dialogue feature.
 */
export interface SettingDialogueState {
    settingTab?: ObsidianLiveSyncSettingTab;
}
/**
 * Creates the initial state object.
 */
export declare function createInitialState(): SettingDialogueState;
