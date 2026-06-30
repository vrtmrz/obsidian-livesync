// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ObsidianLiveSyncSettings } from "./setting.type";
export declare const LEVEL_ADVANCED = "ADVANCED";
export declare const LEVEL_POWER_USER = "POWER_USER";
export declare const LEVEL_EDGE_CASE = "EDGE_CASE";
export type ConfigLevel = "" | "ADVANCED" | "POWER_USER" | "EDGE_CASE";
export type ConfigurationItem = {
    name: string;
    desc?: string;
    placeHolder?: string;
    status?: "BETA" | "ALPHA" | "EXPERIMENTAL";
    obsolete?: boolean;
    level?: ConfigLevel;
    isHidden?: boolean;
    isAdvanced?: boolean;
};
export declare const configurationNames: Partial<Record<keyof ObsidianLiveSyncSettings, ConfigurationItem>>;
/**
 * Get human readable Configuration stability
 * @param status
 * @returns
 */
export declare function statusDisplay(status?: string): string;
/**
 * Get human readable configuration name.
 * @param key configuration key
 * @param alt
 * @returns
 */
export declare function confName(key: keyof ObsidianLiveSyncSettings, alt?: string): string;
/**
 * Get human readable configuration description.
 * @param key configuration key
 * @param alt
 * @returns
 */
export declare function confDesc(key: keyof ObsidianLiveSyncSettings, alt?: string): string | undefined;
