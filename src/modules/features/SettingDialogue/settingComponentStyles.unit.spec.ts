import type { ButtonComponent, Setting } from "@/deps.ts";
import { describe, expect, it, vi } from "vitest";
import {
    setButtonAdditionalActionState,
    setButtonDestructiveState,
    setSettingAdditionalActionsState,
} from "./settingComponentStyles.ts";

type CompatibleButton = ButtonComponent & {
    setDestructive?: () => ButtonComponent;
    removeDestructive?: () => ButtonComponent;
};

function createButton(overrides: Partial<CompatibleButton> = {}): CompatibleButton {
    return {
        buttonEl: {
            classList: {
                toggle: vi.fn(),
            },
        },
        ...overrides,
    } as unknown as CompatibleButton;
}

function createSetting(): Setting {
    return {
        settingEl: {
            classList: {
                toggle: vi.fn(),
            },
        },
    } as unknown as Setting;
}

describe("setSettingAdditionalActionsState", () => {
    it("sets whether the supplied setting row contains additional actions", () => {
        const setting = createSetting();

        expect(setSettingAdditionalActionsState(setting, true)).toBe(setting);
        expect(setSettingAdditionalActionsState(setting, false)).toBe(setting);
        expect(setting.settingEl.classList.toggle).toHaveBeenNthCalledWith(
            1,
            "sls-setting-with-additional-actions",
            true
        );
        expect(setting.settingEl.classList.toggle).toHaveBeenNthCalledWith(
            2,
            "sls-setting-with-additional-actions",
            false
        );
    });
});

describe("setButtonAdditionalActionState", () => {
    it("sets whether the supplied button is an additional action", () => {
        const button = createButton();

        expect(setButtonAdditionalActionState(button, true)).toBe(button);
        expect(setButtonAdditionalActionState(button, false)).toBe(button);
        expect(button.buttonEl.classList.toggle).toHaveBeenNthCalledWith(1, "sls-setting-additional-action", true);
        expect(button.buttonEl.classList.toggle).toHaveBeenNthCalledWith(2, "sls-setting-additional-action", false);
    });
});

describe("setButtonDestructiveState", () => {
    it("uses the native destructive-button API when it is available", () => {
        const setDestructive = vi.fn();
        const removeDestructive = vi.fn();
        const button = createButton({ setDestructive, removeDestructive });

        expect(setButtonDestructiveState(button, true)).toBe(button);
        expect(setButtonDestructiveState(button, false)).toBe(button);

        expect(setDestructive).toHaveBeenCalledOnce();
        expect(removeDestructive).toHaveBeenCalledOnce();
        expect(button.buttonEl.classList.toggle).not.toHaveBeenCalled();
    });

    it("uses the legacy warning class when the native API is unavailable", () => {
        const button = createButton();

        setButtonDestructiveState(button, true);
        setButtonDestructiveState(button, false);

        expect(button.buttonEl.classList.toggle).toHaveBeenNthCalledWith(1, "mod-warning", true);
        expect(button.buttonEl.classList.toggle).toHaveBeenNthCalledWith(2, "mod-warning", false);
    });
});
