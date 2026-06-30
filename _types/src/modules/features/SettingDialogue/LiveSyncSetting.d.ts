// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { Setting, TextComponent, type ToggleComponent, type DropdownComponent, ButtonComponent, type TextAreaComponent, type ValueComponent } from "@/deps.ts";
import { type ConfigurationItem } from "@lib/common/types.ts";
import { type ObsidianLiveSyncSettingTab } from "./ObsidianLiveSyncSettingTab.ts";
import { type AllSettingItemKey, type AllSettings, type AllStringItemKey, type AllNumericItemKey, type AllBooleanItemKey } from "./settingConstants.ts";
import { type AutoWireOption, type OnUpdateResult } from "./SettingPane.ts";
export declare class LiveSyncSetting extends Setting {
    autoWiredComponent?: TextComponent | ToggleComponent | DropdownComponent | ButtonComponent | TextAreaComponent;
    applyButtonComponent?: ButtonComponent;
    selfKey?: AllSettingItemKey;
    watchDirtyKeys: AllSettingItemKey[];
    holdValue: boolean;
    static env: ObsidianLiveSyncSettingTab;
    descBuf: string | DocumentFragment;
    nameBuf: string | DocumentFragment;
    placeHolderBuf: string;
    hasPassword: boolean;
    invalidateValue?: () => void;
    setValue?: (value: unknown) => void;
    constructor(containerEl: HTMLElement);
    setDesc(desc: string | DocumentFragment): this;
    setName(name: string | DocumentFragment): this;
    setAuto(key: AllSettingItemKey, opt?: AutoWireOption): this;
    autoWireSetting(key: AllSettingItemKey, opt?: AutoWireOption): {
        name: string;
        desc?: string;
        placeHolder?: string;
        status?: "BETA" | "ALPHA" | "EXPERIMENTAL";
        obsolete?: boolean;
        level?: import("@lib/common/types.ts").ConfigLevel;
        isHidden?: boolean;
        isAdvanced?: boolean;
    } | undefined;
    autoWireComponent<T>(component: ValueComponent<T>, conf?: ConfigurationItem, opt?: AutoWireOption): void;
    commitValue<T extends AllSettingItemKey>(value: AllSettings[T]): Promise<void>;
    autoWireText(key: AllStringItemKey, opt?: AutoWireOption): this;
    autoWireTextArea(key: AllStringItemKey, opt?: AutoWireOption): this;
    autoWireNumeric(key: AllNumericItemKey, opt: AutoWireOption & {
        clampMin?: number;
        clampMax?: number;
        acceptZero?: boolean;
    }): this;
    autoWireToggle(key: AllBooleanItemKey, opt?: AutoWireOption): this;
    autoWireDropDown<T extends string>(key: AllStringItemKey, opt: AutoWireOption & {
        options: Record<T, string>;
    }): this;
    addApplyButton(keys: AllSettingItemKey[], text?: string): this;
    addOnUpdate(func: () => OnUpdateResult): this;
    updateHandlers: Set<() => OnUpdateResult>;
    prevStatus: OnUpdateResult;
    _getComputedStatus(): OnUpdateResult;
    _applyOnUpdateHandlers(): void;
    _onUpdate(): void;
}
