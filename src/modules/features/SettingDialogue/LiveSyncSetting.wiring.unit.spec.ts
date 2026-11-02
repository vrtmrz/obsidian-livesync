import { describe, expect, it, vi } from "vitest";

const liveSyncSettingHarness = vi.hoisted(() => ({
    components: [] as unknown[],
    settingElements: [] as unknown[],
}));

vi.mock("@/deps.ts", () => {
    class StringComponent {
        values: string[] = [];
        changeHandler?: (value: string) => Promise<void>;
        placeholder?: string;
        inputEl = {
            attributes: new Map<string, string>(),
            setAttribute(name: string, value: string) {
                this.attributes.set(name, value);
            },
            toggleClass: (_name: string, _enabled: boolean) => {},
        };
        setValue(value: string) {
            this.values.push(value);
        }
        onChange(handler: (value: string) => Promise<void>) {
            this.changeHandler = handler;
            return this;
        }
        setPlaceholder(value: string) {
            this.placeholder = value;
            return this;
        }
        constructor() {
            liveSyncSettingHarness.components.push(this);
        }
    }
    class TextComponent extends StringComponent {}
    class TextAreaComponent extends StringComponent {}
    class Setting {
        settingEl = {
            classes: [] as { name: string; enabled: boolean }[],
            toggleClass(name: string, enabled: boolean) {
                this.classes.push({ name, enabled });
            },
        };
        constructor(_containerEl: HTMLElement) {
            liveSyncSettingHarness.settingElements.push(this.settingEl);
        }
        setDesc(_description: string | DocumentFragment) {
            return this;
        }
        setName(_name: string | DocumentFragment) {
            return this;
        }
        addText(callback: (component: TextComponent) => void) {
            callback(new TextComponent());
            return this;
        }
        addTextArea(callback: (component: TextAreaComponent) => void) {
            callback(new TextAreaComponent());
            return this;
        }
        setTooltip(_description: string) {
            return this;
        }
        setDisabled(_disabled: boolean) {
            return this;
        }
    }
    return { Setting, TextComponent, TextAreaComponent, ButtonComponent: class {} };
});
vi.mock("./ObsidianLiveSyncSettingTab.ts", () => ({}));
vi.mock("@/common/translation", () => ({ $msg: (key: string) => key }));
vi.mock("@vrtmrz/livesync-commonlib/compat/common/types", () => ({
    LEVEL_ADVANCED: 1,
    LEVEL_POWER_USER: 2,
    statusDisplay: () => "",
}));
vi.mock("./settingConstants.ts", () => ({
    getConfig: (key: string) => ({
        name: key,
        desc: `description for ${key}`,
        placeHolder: `configured placeholder for ${key}`,
    }),
}));
vi.mock("./settingComponentStyles.ts", () => ({ setButtonDestructiveState: vi.fn() }));
vi.mock("octagonal-wheels/collection", () => ({ unique: (items: unknown[]) => [...new Set(items)] }));

import { LiveSyncSetting } from "./LiveSyncSetting.ts";

type WireKind = "text" | "textarea";
type StringComponentHarness = {
    values: string[];
    changeHandler?: (value: string) => Promise<void>;
    placeholder?: string;
    inputEl: { attributes: Map<string, string> };
};
type SettingElementHarness = { classes: { name: string; enabled: boolean }[] };

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function wireStringSetting(
    kind: WireKind,
    options: {
        holdValue?: boolean;
        isPassword?: boolean;
        placeHolder?: string;
        onUpdate?: () => { visibility?: boolean };
    } = {}
) {
    const key = kind === "text" ? "syncOnlyRegEx" : "ignoreFiles";
    const events: string[] = [];
    const editingSettings: Record<string, unknown> = { [key]: 17 };
    const saveSettings = vi.fn(async (_keys: string[]) => {});
    const requestUpdate = vi.fn(() => events.push("update"));
    const env = {
        settingComponents: [] as unknown[],
        editingSettings,
        saveSettings,
        requestUpdate,
    };
    LiveSyncSetting.env = env as never;

    const setting = new LiveSyncSetting({} as HTMLElement);
    const onUpdate = vi.fn(options.onUpdate ?? (() => ({ visibility: false })));
    const wireOptions = { ...options, onUpdate };
    if (kind === "text") {
        setting.autoWireText(key as never, wireOptions);
    } else {
        setting.autoWireTextArea(key as never, wireOptions);
    }

    return {
        key,
        events,
        editingSettings,
        saveSettings,
        requestUpdate,
        setting,
        component: setting.autoWiredComponent as unknown as StringComponentHarness,
        settingElement: setting.settingEl as unknown as SettingElementHarness,
        onUpdate,
    };
}

describe("LiveSyncSetting string controls", () => {
    it.each(["text", "textarea"] as const)("wires %s through the shared string commit contract", async (kind) => {
        const {
            key,
            events,
            editingSettings,
            saveSettings,
            requestUpdate,
            setting,
            component,
            settingElement,
            onUpdate,
        } = wireStringSetting(kind, { isPassword: true, placeHolder: "option placeholder" });

        expect(component.values).toEqual(["17"]);
        setting.invalidateValue?.();
        expect(component.values).toEqual(["17"]);
        editingSettings[key] = 18;
        setting.invalidateValue?.();
        expect(component.values).toEqual(["17", "18"]);
        expect(component.inputEl.attributes.get("type")).toBe("password");
        expect(setting.hasPassword).toBe(true);
        expect(setting.updateHandlers.size).toBe(1);
        expect(onUpdate).toHaveBeenCalledTimes(1);
        expect(setting._getComputedStatus()).toEqual({ visibility: false });
        expect(onUpdate).toHaveBeenCalledTimes(2);
        expect(settingElement.classes).toContainEqual({ name: "sls-setting-hidden", enabled: true });
        if (kind === "text") {
            expect(component.placeholder).toBe("configured placeholder for syncOnlyRegEx");
        } else {
            expect(component.placeholder).toBeUndefined();
        }

        const pendingSave = deferred();
        saveSettings.mockImplementationOnce(async (keys) => {
            events.push(`save:${keys.join(",")}`);
            await pendingSave.promise;
            events.push("saved");
        });
        const commit = component.changeHandler!("changed");
        expect(editingSettings[key]).toBe("changed");
        expect(saveSettings).toHaveBeenCalledWith([key]);
        expect(events).toEqual([`save:${key}`]);
        expect(requestUpdate).not.toHaveBeenCalled();
        pendingSave.resolve();
        await commit;
        expect(events).toEqual([`save:${key}`, "saved", "update"]);

        events.length = 0;
        await component.changeHandler!("changed");
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(events).toEqual(["update"]);

        events.length = 0;
        const failure = new Error("setting save failed");
        saveSettings.mockImplementationOnce(async (keys) => {
            events.push(`save:${keys.join(",")}`);
            throw failure;
        });
        await expect(component.changeHandler!("failed")).rejects.toBe(failure);
        expect(editingSettings[key]).toBe("failed");
        expect(events).toEqual([`save:${key}`]);
        expect(requestUpdate).toHaveBeenCalledTimes(2);
    });

    it.each(["text", "textarea"] as const)("keeps %s held values in the editing copy without saving", async (kind) => {
        const { key, editingSettings, saveSettings, requestUpdate, component, events } = wireStringSetting(kind, {
            holdValue: true,
        });

        await component.changeHandler!("held value");

        expect(editingSettings[key]).toBe("held value");
        expect(saveSettings).not.toHaveBeenCalled();
        expect(requestUpdate).toHaveBeenCalledOnce();
        expect(events).toEqual(["update"]);
    });
});
