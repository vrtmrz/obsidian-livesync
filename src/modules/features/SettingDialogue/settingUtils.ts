import { escapeStringToHTML } from "octagonal-wheels/string";
import { E2EEAlgorithmNames, type ObsidianLiveSyncSettings } from "../../../lib/src/common/types";
import {
    pickCouchDBSyncSettings,
    pickBucketSyncSettings,
    pickP2PSyncSettings,
    pickEncryptionSettings,
} from "../../../lib/src/common/utils";
import { getConfig, type AllSettingItemKey } from "./settingConstants";

/**
 * Generates a summary of P2P configuration settings
 * @param setting Settings object
 * @param additional Additional summary information to include
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export function getP2PConfigSummary(
    setting: ObsidianLiveSyncSettings,
    additional: Record<string, string> = {},
    showAdvanced = false
) {
    const settingTable: Partial<ObsidianLiveSyncSettings> = pickP2PSyncSettings(setting);
    return { ...getSummaryFromPartialSettings({ ...settingTable }, showAdvanced), ...additional };
}
/**
 * Generates a summary of Object Storage configuration settings
 * @param setting Settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export function getBucketConfigSummary(setting: ObsidianLiveSyncSettings, showAdvanced = false) {
    const settingTable: Partial<ObsidianLiveSyncSettings> = pickBucketSyncSettings(setting);
    return getSummaryFromPartialSettings(settingTable, showAdvanced);
}
/**
 * Generates a summary of CouchDB configuration settings
 * @param setting Settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export function getCouchDBConfigSummary(setting: ObsidianLiveSyncSettings, showAdvanced = false) {
    const settingTable: Partial<ObsidianLiveSyncSettings> = pickCouchDBSyncSettings(setting);
    return getSummaryFromPartialSettings(settingTable, showAdvanced);
}

/**
 * Generates a summary of E2EE configuration settings
 * @param setting Settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export function getE2EEConfigSummary(setting: ObsidianLiveSyncSettings, showAdvanced = false) {
    const settingTable: Partial<ObsidianLiveSyncSettings> = pickEncryptionSettings(setting);
    return getSummaryFromPartialSettings(settingTable, showAdvanced);
}

/**
 * Converts partial settings into a summary object
 * @param setting Partial settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export function getSummaryFromPartialSettings(setting: Partial<ObsidianLiveSyncSettings>, showAdvanced = false) {
    const outputSummary: Record<string, string> = {};
    for (const key of Object.keys(setting) as (keyof ObsidianLiveSyncSettings)[]) {
        const config = getConfig(key as AllSettingItemKey);
        if (!config) continue;
        if (config.isAdvanced && !showAdvanced) continue;
        const value =
            key != "E2EEAlgorithm"
                ? `${setting[key]}`
                : E2EEAlgorithmNames[`${setting[key]}` as keyof typeof E2EEAlgorithmNames];
        const displayValue = config.isHidden ? "•".repeat(value.length) : escapeStringToHTML(value);
        outputSummary[config.name] = displayValue;
    }
    return outputSummary;
}
