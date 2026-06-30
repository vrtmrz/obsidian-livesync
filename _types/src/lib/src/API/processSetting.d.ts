// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ObsidianLiveSyncSettings } from "@lib/common/types";
/**
 * Encode settings to a tiny array to encode in QRCode,
 * Due to size limitation of QR code, we encode settings as an array instead of object.
 * @param settings settings to encode
 */
export declare function encodeSettingsToQRCodeData(settings: ObsidianLiveSyncSettings): string;
/**
 * Decode settings from QR code data string
 * @param qr data string from QR code
 * @returns Decoded settings
 */
export declare function decodeSettingsFromQRCodeData(qr: string): ObsidianLiveSyncSettings;
export declare const enum OutputFormat {
    SVG = 0,
    ASCII = 1
}
export interface SplitQRCodeData {
    total: number;
    parts: string[];
}
/**
 * Encode setting string to QR code in specified format
 * @param settingString Setting string to encode
 * @param format Output format
 */
export declare function encodeQR(settingString: string, format: OutputFormat): string | SplitQRCodeData;
type ErasureProperties = keyof ObsidianLiveSyncSettings;
/**
 * Generate setup URI with encrypted settings
 * @param settingString Settings to encode
 * @param passphrase Passphrase to encrypt the settings
 * @param removeProperties Properties to remove from the settings
 * Means these properties will not be included in the generated setup URI,
 * See also necessaryErasureProperties for properties that will always be removed.
 * @param skipDefaultValue Whether to skip default values
 * @returns Generated setup URI
 */
export declare function encodeSettingsToSetupURI(settingString: ObsidianLiveSyncSettings, passphrase: string, removeProperties?: ErasureProperties[], skipDefaultValue?: boolean): Promise<string>;
export declare function decodeSettingsFromSetupURI(uri: string, passphrase: string): Promise<false | ObsidianLiveSyncSettings>;
export {};
