// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { Confirm } from "@lib/interfaces/Confirm";
import { type ObsidianLiveSyncSettings } from "./types";
declare enum ConditionType {
    PLATFORM_CASE_INSENSITIVE = "platform-case-insensitive",
    PLATFORM_CASE_SENSITIVE = "platform-case-sensitive",
    REMOTE_CASE_SENSITIVE = "remote-case-sensitive"
}
export declare enum RuleLevel {
    Must = 0,
    Necessary = 1,
    Recommended = 2,
    Optional = 3
}
type BaseRule<TType extends string, TValue> = {
    level?: RuleLevel;
    requireRebuild?: boolean;
    requireRebuildLocal?: boolean;
    recommendRebuild?: boolean;
    reason?: string;
    reasonFunc?: (settings: Partial<ObsidianLiveSyncSettings>) => string;
    condition?: ConditionType[];
    detectionFunc?: (settings: Partial<ObsidianLiveSyncSettings>) => boolean;
    value?: TValue;
    valueDisplay?: string;
    valueDisplayFunc?: (settings: Partial<ObsidianLiveSyncSettings>) => string;
    obsoleteValues?: TValue[];
};
type NumberRuleExact = BaseRule<"number", number> & {}; // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types -- Empty object type
type NumberRuleRange = BaseRule<"number", number> & {
    min?: number;
    max?: number;
    step?: number;
};
type StringRangeRule = BaseRule<"string", string> & {
    minLength?: number;
    maxLength?: number;
    regexp?: string;
};
type StringRule = BaseRule<"string", string> & {}; // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types -- Empty object type
type BooleanRule = BaseRule<"boolean", boolean> & {}; // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types -- Empty object type
export type RuleForType<T> = T extends number ? NumberRuleExact | NumberRuleRange : T extends string ? StringRule | StringRangeRule : T extends boolean ? BooleanRule : never;
type DoctorCheckSettings = Omit<Partial<ObsidianLiveSyncSettings>, "remoteConfigurations" | "pluginSyncExtendedSetting">;
export type DoctorRegulation = {
    version: string;
    rules: {
        [P in keyof DoctorCheckSettings]: RuleForType<DoctorCheckSettings[P]>;
    };
};
export declare const DoctorRegulationV0_24_16: DoctorRegulation;
export declare const DoctorRegulationV0_24_30: DoctorRegulation;
export declare const DoctorRegulationV0_25_0: DoctorRegulation;
export declare const DoctorRegulationV0_25_27: DoctorRegulation;
export declare const DoctorRegulation: DoctorRegulation;
export declare function checkUnsuitableValues(setting: Partial<ObsidianLiveSyncSettings>, regulation?: DoctorRegulation): DoctorRegulation;
export declare const RebuildOptions: {
    readonly AutomaticAcceptable: 0;
    readonly ConfirmIfRequired: 1;
    readonly SkipEvenIfRequired: 2;
};
export type RebuildOptionsType = (typeof RebuildOptions)[keyof typeof RebuildOptions];
export type DoctorOptions = {
    localRebuild: RebuildOptionsType;
    remoteRebuild: RebuildOptionsType;
    activateReason?: string;
    forceRescan?: boolean;
};
export type DoctorResult = {
    settings: ObsidianLiveSyncSettings;
    shouldRebuild: boolean;
    shouldRebuildLocal: boolean;
    isModified: boolean;
};
export type HasConfirm = {
    confirm: Confirm;
};
export declare function performDoctorConsultation(env: HasConfirm, settings: ObsidianLiveSyncSettings, { localRebuild, remoteRebuild, activateReason, forceRescan, }: DoctorOptions): Promise<DoctorResult>;
export {};
