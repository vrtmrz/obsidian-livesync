import type { ButtonComponent, Setting } from "@/deps.ts";

const SETTING_WITH_ADDITIONAL_ACTIONS_CLASS = "sls-setting-with-additional-actions";
const ADDITIONAL_ACTION_CLASS = "sls-setting-additional-action";

/**
 * Applies destructive-action styling without requiring Obsidian 1.13 at
 * runtime. Older supported versions used the `mod-warning` class for the same
 * presentation.
 */
export function setButtonDestructiveState<T extends ButtonComponent>(button: T, isDestructive = true): T {
    const compatibleButton = button as unknown as {
        setDestructive?: () => ButtonComponent;
        removeDestructive?: () => ButtonComponent;
    };
    const updateNativeStyle = isDestructive ? compatibleButton.setDestructive : compatibleButton.removeDestructive;
    if (typeof updateNativeStyle === "function") {
        updateNativeStyle.call(button);
    } else {
        button.buttonEl.classList.toggle("mod-warning", isDestructive);
    }
    return button;
}

/** Sets whether a setting row contains actions which may move onto a later line. */
export function setSettingAdditionalActionsState<T extends Setting>(setting: T, hasAdditionalActions = true): T {
    setting.settingEl.classList.toggle(SETTING_WITH_ADDITIONAL_ACTIONS_CLASS, hasAdditionalActions);
    return setting;
}

/** Sets whether a button is an additional action which may move onto a later line. */
export function setButtonAdditionalActionState<T extends ButtonComponent>(button: T, isAdditionalAction = true): T {
    button.buttonEl.classList.toggle(ADDITIONAL_ACTION_CLASS, isAdditionalAction);
    return button;
}
