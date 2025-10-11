import { $msg } from "../../../lib/src/common/i18n";
import { LEVEL_ADVANCED, LEVEL_EDGE_CASE, LEVEL_POWER_USER, type ConfigLevel } from "../../../lib/src/common/types";
import type { AllSettingItemKey, AllSettings } from "./settingConstants";

export const combineOnUpdate = (func1: OnUpdateFunc, func2: OnUpdateFunc): OnUpdateFunc => {
    return () => ({
        ...func1(),
        ...func2(),
    });
};
export const setLevelClass = (el: HTMLElement, level?: ConfigLevel) => {
    switch (level) {
        case LEVEL_POWER_USER:
            el.addClass("sls-setting-poweruser");
            break;
        case LEVEL_ADVANCED:
            el.addClass("sls-setting-advanced");
            break;
        case LEVEL_EDGE_CASE:
            el.addClass("sls-setting-edgecase");
            break;
        default:
        // NO OP.
    }
};
export function setStyle(el: HTMLElement, styleHead: string, condition: () => boolean) {
    if (condition()) {
        el.addClass(`${styleHead}-enabled`);
        el.removeClass(`${styleHead}-disabled`);
    } else {
        el.addClass(`${styleHead}-disabled`);
        el.removeClass(`${styleHead}-enabled`);
    }
}

export function visibleOnly(cond: () => boolean): OnUpdateFunc {
    return () => ({
        visibility: cond(),
    });
}
export function enableOnly(cond: () => boolean): OnUpdateFunc {
    return () => ({
        disabled: !cond(),
    });
}

export type OnUpdateResult = {
    visibility?: boolean;
    disabled?: boolean;
    classes?: string[];
    isCta?: boolean;
    isWarning?: boolean;
};
export type OnUpdateFunc = () => OnUpdateResult;
export type UpdateFunction = () => void;

export type OnSavedHandlerFunc<T extends AllSettingItemKey> = (value: AllSettings[T]) => Promise<void> | void;
export type OnSavedHandler<T extends AllSettingItemKey> = {
    key: T;
    handler: OnSavedHandlerFunc<T>;
};

export function getLevelStr(level: ConfigLevel) {
    return level == LEVEL_POWER_USER
        ? $msg("obsidianLiveSyncSettingTab.levelPowerUser")
        : level == LEVEL_ADVANCED
          ? $msg("obsidianLiveSyncSettingTab.levelAdvanced")
          : level == LEVEL_EDGE_CASE
            ? $msg("obsidianLiveSyncSettingTab.levelEdgeCase")
            : "";
}

export type AutoWireOption = {
    placeHolder?: string;
    holdValue?: boolean;
    isPassword?: boolean;
    invert?: boolean;
    onUpdate?: OnUpdateFunc;
    obsolete?: boolean;
};

export function findAttrFromParent(el: HTMLElement, attr: string): string {
    let current: HTMLElement | null = el;
    while (current) {
        const value = current.getAttribute(attr);
        if (value) {
            return value;
        }
        current = current.parentElement;
    }
    return "";
}

export function wrapMemo<T>(func: (arg: T) => void) {
    let buf: T | undefined = undefined;
    return (arg: T) => {
        if (buf !== arg) {
            func(arg);
            buf = arg;
        }
    };
}
export type PageFunctions = {
    addPane: (
        parentEl: HTMLElement,
        title: string,
        icon: string,
        order: number,
        wizardHidden: boolean,
        level?: ConfigLevel
    ) => Promise<HTMLDivElement>;
    addPanel: (
        parentEl: HTMLElement,
        title: string,
        callback?: (el: HTMLDivElement) => void,
        func?: OnUpdateFunc,
        level?: ConfigLevel
    ) => Promise<HTMLDivElement>;
};
