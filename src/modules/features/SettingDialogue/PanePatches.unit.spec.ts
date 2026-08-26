import { afterEach, describe, expect, it, vi } from "vitest";
import { panePatches } from "./PanePatches.ts";

const remediationHarness = vi.hoisted(() => {
    const dateElement = { textContent: "" };
    const createSpan = vi.fn(() => dateElement);
    const inputEl = {
        type: "",
    };
    const textComponent = {
        inputEl,
        onChange: vi.fn(),
        setValue: vi.fn(),
    };
    const addButtonClass = vi.fn();
    const setClass = vi.fn();

    return {
        addButtonClass,
        createSpan,
        dateElement,
        inputEl,
        setClass,
        textComponent,
    };
});

vi.mock("./LiveSyncSetting.ts", () => ({
    LiveSyncSetting: class LiveSyncSetting {
        applyButtonComponent = {
            buttonEl: {
                addClass: remediationHarness.addButtonClass,
            },
        };
        controlEl = {
            createSpan: remediationHarness.createSpan,
        };

        addText(callback: (text: typeof remediationHarness.textComponent) => void): this {
            callback(remediationHarness.textComponent);
            return this;
        }

        setAuto(): this {
            return this;
        }

        setClass(value: string): this {
            remediationHarness.setClass(value);
            return this;
        }

        addApplyButton(): this {
            return this;
        }

        autoWireToggle(): this {
            return this;
        }
    },
}));

afterEach(() => {
    Reflect.deleteProperty(globalThis, "activeDocument");
    vi.clearAllMocks();
    remediationHarness.dateElement.textContent = "";
    remediationHarness.inputEl.type = "";
});

describe("panePatches remediation setting", () => {
    it("creates the status element in the setting control instead of the document", () => {
        const hierarchyError = new DOMException(
            "Failed to execute 'appendChild' on 'Node': Only one element on document allowed.",
            "HierarchyRequestError"
        );
        const createSpan = vi.fn(() => {
            throw hierarchyError;
        });
        Object.defineProperty(globalThis, "activeDocument", {
            configurable: true,
            value: { createSpan },
        });

        const host = {
            addOnSaved: vi.fn(),
            editingSettings: {
                maxMTimeForReflectEvents: 0,
            },
            requestUpdate: vi.fn(),
        };
        const addPanel = vi.fn((_paneEl: HTMLElement, title: string) => ({
            then(callback: (paneEl: HTMLElement) => void) {
                if (title === "Remediation") {
                    callback({} as HTMLElement);
                }
                return Promise.resolve();
            },
        }));

        panePatches.call(
            host as never,
            {} as HTMLElement,
            {
                addPanel,
            } as never
        );
        expect(createSpan).not.toHaveBeenCalled();
        expect(remediationHarness.createSpan).toHaveBeenCalledOnce();
        expect(remediationHarness.dateElement.textContent).toBe("No limit configured");
        expect(remediationHarness.setClass).toHaveBeenCalledWith("sls-setting-row-with-subsequent-buttons");
        expect(remediationHarness.addButtonClass).toHaveBeenCalledWith("sls-setting-subsequent-button");
    });
});
