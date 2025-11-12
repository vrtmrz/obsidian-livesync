import { escapeStringToHTML } from "octagonal-wheels/string";
import {
    E2EEAlgorithmNames,
    MILESTONE_DOCID,
    NODEINFO_DOCID,
    type ObsidianLiveSyncSettings,
} from "../../../lib/src/common/types";
import {
    pickCouchDBSyncSettings,
    pickBucketSyncSettings,
    pickP2PSyncSettings,
    pickEncryptionSettings,
} from "../../../lib/src/common/utils";
import { getConfig, type AllSettingItemKey } from "./settingConstants";
import { LOG_LEVEL_NOTICE, Logger } from "octagonal-wheels/common/logger";

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
    return getSummaryFromPartialSettings(settingTable, showAdvanced || setting.useJWT);
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

// Migration or de-migration helper functions

/**
 * Copy document from one database to another for migration purposes
 * @param docName document ID
 * @param dbFrom source database
 * @param dbTo destination database
 * @returns
 */
export async function copyMigrationDocs(docName: string, dbFrom: PouchDB.Database, dbTo: PouchDB.Database) {
    try {
        const doc = await dbFrom.get(docName);
        delete (doc as any)._rev;
        await dbTo.put(doc);
    } catch (e) {
        if ((e as any).status === 404) {
            return;
        }
        throw e;
    }
}

type PouchDBOpenFunction = () => Promise<PouchDB.Database> | PouchDB.Database;

/**
 * Migrate databases from one to another
 * @param operationName Name of the migration operation
 * @param from source database
 * @param openTo function to open destination database
 * @returns True if migration succeeded
 */
export async function migrateDatabases(operationName: string, from: PouchDB.Database, openTo: PouchDBOpenFunction) {
    const dbTo = await openTo();
    await dbTo.info(); // ensure created
    Logger(`Opening destination database for migration: ${operationName}.`, LOG_LEVEL_NOTICE, "migration");
    // destroy existing data
    await dbTo.destroy();
    Logger(`Destroyed existing destination database for migration: ${operationName}.`, LOG_LEVEL_NOTICE, "migration");

    const dbTo2 = await openTo();
    const info2 = await dbTo2.info(); // ensure created
    console.log(info2);
    Logger(`Re-created destination database for migration: ${operationName}.`, LOG_LEVEL_NOTICE, "migration");

    const info = await from.info();
    const totalDocs = info.doc_count || 0;
    const result = await from.replicate
        .to(dbTo2, {
            //@ts-ignore Missing in typedefs
            style: "all_docs",
        })
        .on("change", (info) => {
            Logger(
                `Replicating... Docs replicated: ${info.docs_written} / ${totalDocs}`,
                LOG_LEVEL_NOTICE,
                "migration"
            );
        });
    if (result.ok) {
        Logger(`Replication completed for migration: ${operationName}.`, LOG_LEVEL_NOTICE, "migration");
    } else {
        throw new Error(`Replication failed for migration: ${operationName}.`);
    }
    await copyMigrationDocs(MILESTONE_DOCID, from, dbTo2);
    await copyMigrationDocs(NODEINFO_DOCID, from, dbTo2);
    Logger(`Copied migration documents for migration: ${operationName}.`, LOG_LEVEL_NOTICE, "migration");
    await dbTo2.close();
    return true;
}
