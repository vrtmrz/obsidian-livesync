import type { ButtonComponent, Setting } from "@/deps.ts";
import { describe, expect, it, vi } from "vitest";
import { markSettingRowWithSubsequentButtons, markSubsequentButton, setButtonDestructiveState } from "./SettingPane.ts";

type CompatibleButton = ButtonComponent & {
    setDestructive?: () => ButtonComponent;
    removeDestructive?: () => ButtonComponent;
};

function createButton(overrides: Partial<CompatibleButton> = {}): CompatibleButton {
    return {
        buttonEl: {
            addClass: vi.fn(),
            classList: {
                toggle: vi.fn(),
            },
        },
        ...overrides,
    } as unknown as CompatibleButton;
}

function createSetting(): Setting {
    return {
        setClass: vi.fn().mockReturnThis(),
    } as unknown as Setting;
}

describe("markSettingRowWithSubsequentButtons", () => {
    it("marks only the supplied setting row as containing subsequent actions", () => {
        const setting = createSetting();

        expect(markSettingRowWithSubsequentButtons(setting)).toBe(setting);
        expect(setting.setClass).toHaveBeenCalledWith("sls-setting-row-with-subsequent-buttons");
    });
});

describe("markSubsequentButton", () => {
    it("marks only the supplied button as a subsequent action", () => {
        const button = createButton();

        expect(markSubsequentButton(button)).toBe(button);
        expect(button.buttonEl.addClass).toHaveBeenCalledWith("sls-setting-subsequent-button");
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
