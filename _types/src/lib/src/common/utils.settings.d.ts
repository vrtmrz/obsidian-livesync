import type { ObsidianLiveSyncSettings, P2PConnectionInfo, BucketSyncSetting, CouchDBConnection, EncryptionSettings } from "@lib/common/models/setting.type";
/**
 * Copies properties from the source object to the target object only if they exist in the target.
 * @param source The object to copy properties from.
 * @param target The object to copy properties to.
 */
export declare function copyTo<T extends object, U extends T>(source: U, target: T): void;
export declare function pickBucketSyncSettings(setting: ObsidianLiveSyncSettings): BucketSyncSetting;
export declare function pickCouchDBSyncSettings(setting: ObsidianLiveSyncSettings): CouchDBConnection;
export declare function pickEncryptionSettings(setting: ObsidianLiveSyncSettings | EncryptionSettings): EncryptionSettings;
export declare function pickP2PSyncSettings(setting: Partial<ObsidianLiveSyncSettings> & P2PConnectionInfo): P2PConnectionInfo;
/**
 * Generate a random P2P Room ID in the format `123-456-789-abc`.
 */
export declare function generateP2PRoomId(): string;
/**
 * Extract the stable suffix (last segment) from a Room ID.
 */
export declare function extractP2PRoomSuffix(roomId: string): string;
