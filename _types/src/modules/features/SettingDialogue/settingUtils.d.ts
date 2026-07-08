// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type ObsidianLiveSyncSettings } from "@lib/common/types";
/**
 * Generates a summary of P2P configuration settings
 * @param setting Settings object
 * @param additional Additional summary information to include
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export declare function getP2PConfigSummary(setting: ObsidianLiveSyncSettings, additional?: Record<string, string>, showAdvanced?: boolean): {
    [x: string]: string;
};
/**
 * Generates a summary of Object Storage configuration settings
 * @param setting Settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export declare function getBucketConfigSummary(setting: ObsidianLiveSyncSettings, showAdvanced?: boolean): Record<string, string>;
/**
 * Generates a summary of CouchDB configuration settings
 * @param setting Settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export declare function getCouchDBConfigSummary(setting: ObsidianLiveSyncSettings, showAdvanced?: boolean): Record<string, string>;
/**
 * Generates a summary of E2EE configuration settings
 * @param setting Settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export declare function getE2EEConfigSummary(setting: ObsidianLiveSyncSettings, showAdvanced?: boolean): Record<string, string>;
/**
 * Converts partial settings into a summary object
 * @param setting Partial settings object
 * @param showAdvanced Whether to include advanced settings
 * @returns Summary object
 */
export declare function getSummaryFromPartialSettings(setting: Partial<ObsidianLiveSyncSettings>, showAdvanced?: boolean): Record<string, string>;
/**
 * Copy document from one database to another for migration purposes
 * @param docName document ID
 * @param dbFrom source database
 * @param dbTo destination database
 * @returns
 */
export declare function copyMigrationDocs(docName: string, dbFrom: PouchDB.Database, dbTo: PouchDB.Database): Promise<void>;
type PouchDBOpenFunction = () => Promise<PouchDB.Database> | PouchDB.Database;
/**
 * Migrate databases from one to another
 * @param operationName Name of the migration operation
 * @param from source database
 * @param openTo function to open destination database
 * @returns True if migration succeeded
 */
export declare function migrateDatabases(operationName: string, from: PouchDB.Database, openTo: PouchDBOpenFunction): Promise<boolean>;
export {};
