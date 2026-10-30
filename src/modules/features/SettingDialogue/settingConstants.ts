export { OnDialogSettingsDefault } from "@vrtmrz/livesync-commonlib/compat/common/settingConstants";
export type { OnDialogSettings } from "@vrtmrz/livesync-commonlib/compat/common/settingConstants";

import {
    AllSettingDefault as CommonlibAllSettingDefault,
    SettingInformation as CommonlibSettingInformation,
    getConfig as getCommonlibConfig,
    getConfName as getCommonlibConfName,
    type AllSettings as CommonlibAllSettings,
    type AllSettingItemKey as CommonlibAllSettingItemKey,
    type AllStringItemKey as CommonlibAllStringItemKey,
    type AllNumericItemKey as CommonlibAllNumericItemKey,
    type AllBooleanItemKey as CommonlibAllBooleanItemKey,
} from "@vrtmrz/livesync-commonlib/compat/common/settingConstants";
import type { ConfigurationItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { MessageTranslator } from "@vrtmrz/livesync-commonlib/context";
import { translateLiveSyncMessage } from "@/common/translation";
import {
    DEFAULT_SYNC_GUARD_SETTINGS,
    isSyncGuardSettingKey,
    type SyncGuardSettingKey,
    type SyncGuardSettings,
} from "@/modules/services/ObsidianSettingService";

export type AllSettings = Omit<CommonlibAllSettings, SyncGuardSettingKey> & SyncGuardSettings;
export type AllStringItemKey = CommonlibAllStringItemKey;
export type AllNumericItemKey = Exclude<CommonlibAllNumericItemKey, SyncGuardSettingKey> | "syncGuardMinimumFiles";
export type AllBooleanItemKey = Exclude<CommonlibAllBooleanItemKey, SyncGuardSettingKey> | "syncGuardEnabled";
export type AllSettingItemKey = Exclude<CommonlibAllSettingItemKey, SyncGuardSettingKey> | SyncGuardSettingKey;
export type ValueOf<T extends AllSettingItemKey> = AllSettings[T];

const syncGuardSettingInformation: Record<SyncGuardSettingKey, ConfigurationItem> = {
    syncGuardEnabled: {
        name: "Enable SyncGuard",
        desc: "Enable device-local SyncGuard protection during synchronisation.",
    },
    syncGuardMinimumFiles: {
        name: "SyncGuard minimum files",
        desc: "Minimum number of Vault files required for SyncGuard protection to apply.",
    },
};

export const AllSettingDefault = { ...CommonlibAllSettingDefault, ...DEFAULT_SYNC_GUARD_SETTINGS };
export const SettingInformation: Partial<Record<AllSettingItemKey, ConfigurationItem>> = {
    ...CommonlibSettingInformation,
    ...syncGuardSettingInformation,
};

// Commonlib defaults `translate` to its English-only translator, so every caller which omits
// it silently renders English regardless of `displayLanguage`. Default it to the LiveSync
// catalogue instead, and re-export these wrappers under the original names so that no call
// site has to remember the second argument.

/** `getConfig` with the LiveSync catalogue applied by default. */
export function getConfig(key: AllSettingItemKey, translate: MessageTranslator = translateLiveSyncMessage) {
    if (isSyncGuardSettingKey(key)) return syncGuardSettingInformation[key];
    return getCommonlibConfig(key, translate);
}

/** `getConfName` with the LiveSync catalogue applied by default. See `getConfig`. */
export function getConfName(key: AllSettingItemKey, translate: MessageTranslator = translateLiveSyncMessage) {
    if (isSyncGuardSettingKey(key)) return syncGuardSettingInformation[key].name;
    return getCommonlibConfName(key, translate);
}
