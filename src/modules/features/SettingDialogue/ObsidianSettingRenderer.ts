import {
    getExplicitSettingCommitGroup,
    getSettingDefinition,
    type AllBooleanItemKey,
    type AllNumericItemKey,
    type AllSettingItemKey,
    type AllStringItemKey,
} from "./settingConstants.ts";
import type { LiveSyncSetting } from "./LiveSyncSetting.ts";
import { LiveSyncSetting as Setting } from "./LiveSyncSetting.ts";
import type { AutoWireOption } from "./SettingPane.ts";

export type ObsidianSettingRenderOption<TOption extends string = string> = AutoWireOption & {
    options?: Record<TOption, string>;
    clampMin?: number;
    clampMax?: number;
    acceptZero?: boolean;
    renderInternal?: boolean;
};

export function addObsidianApplyButton(setting: LiveSyncSetting, group: string, text?: string): LiveSyncSetting {
    const commitGroup = getExplicitSettingCommitGroup(group);
    if (!commitGroup) {
        throw new Error(`No explicit setting commit group found for '${group}'`);
    }
    return setting.addApplyButton(commitGroup.applyKeys, text);
}

export function renderObsidianApplyButton(containerEl: HTMLElement, group: string, text?: string): LiveSyncSetting {
    return addObsidianApplyButton(new Setting(containerEl), group, text);
}

export function renderObsidianSetting<TOption extends string = string>(
    containerEl: HTMLElement,
    key: AllSettingItemKey,
    opt: ObsidianSettingRenderOption<TOption> = {}
): LiveSyncSetting {
    const definition = getSettingDefinition(key);
    if (!definition) {
        throw new Error(`No setting definition found for '${key}'`);
    }
    if (definition.internal && !opt.renderInternal) {
        throw new Error(`Setting '${key}' is internal and cannot be rendered automatically`);
    }
    if (definition.render === "custom" || definition.kind === "custom") {
        throw new Error(`Setting '${key}' requires a custom renderer`);
    }

    const isExplicitCommit = definition.commit?.mode === "explicit";
    const holdValue = opt.holdValue ?? isExplicitCommit;
    const setting = new Setting(containerEl);
    const wireOption = {
        ...opt,
        holdValue,
        settingDefinition: definition,
    };

    if (opt.options) {
        return setting.autoWireDropDown(key as AllStringItemKey, { ...wireOption, options: opt.options });
    }

    switch (definition.kind) {
        case "boolean":
            return setting.autoWireToggle(key as AllBooleanItemKey, wireOption);
        case "number":
            return setting.autoWireNumeric(key as AllNumericItemKey, wireOption);
        case "password":
            return setting.autoWireText(key as AllStringItemKey, { ...wireOption, isPassword: true });
        case "textarea":
            return setting.autoWireTextArea(key as AllStringItemKey, wireOption);
        case "select":
            throw new Error(`Setting '${key}' requires select options`);
        case "text":
            return setting.autoWireText(key as AllStringItemKey, wireOption);
    }
}
