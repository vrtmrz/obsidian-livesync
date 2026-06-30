// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ConfigLevel } from "@lib/common/types";
import type { AllSettingItemKey, AllSettings } from "./settingConstants";
export declare const combineOnUpdate: (func1: OnUpdateFunc, func2: OnUpdateFunc) => OnUpdateFunc;
export declare const setLevelClass: (el: HTMLElement, level?: ConfigLevel) => void;
export declare function setStyle(el: HTMLElement, styleHead: string, condition: () => boolean): void;
export declare function visibleOnly(cond: () => boolean): OnUpdateFunc;
export declare function enableOnly(cond: () => boolean): OnUpdateFunc;
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
export declare function getLevelStr(level: ConfigLevel): "" | import("octagonal-wheels/common/types").TaggedType<string, "obsidianLiveSyncSettingTab.levelPowerUser"> | import("octagonal-wheels/common/types").TaggedType<string, "obsidianLiveSyncSettingTab.levelAdvanced"> | import("octagonal-wheels/common/types").TaggedType<string, "obsidianLiveSyncSettingTab.levelEdgeCase">;
export type AutoWireOption = {
    placeHolder?: string;
    holdValue?: boolean;
    isPassword?: boolean;
    invert?: boolean;
    onUpdate?: OnUpdateFunc;
    obsolete?: boolean;
};
export declare function findAttrFromParent(el: HTMLElement, attr: string): string;
export declare function wrapMemo<T>(func: (arg: T) => void): (arg: T) => void;
export type PageFunctions = {
    addPane: (parentEl: HTMLElement, title: string, icon: string, order: number, wizardHidden: boolean, level?: ConfigLevel) => Promise<HTMLDivElement>;
    addPanel: (parentEl: HTMLElement, title: string, callback?: (el: HTMLDivElement) => void, func?: OnUpdateFunc, level?: ConfigLevel) => Promise<HTMLDivElement>;
};
