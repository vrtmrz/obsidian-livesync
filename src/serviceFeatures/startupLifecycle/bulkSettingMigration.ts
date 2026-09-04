import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { $msg } from "@/common/translation";
import { disableLegacyBulkChunkPreSend } from "@/common/compatibilitySettings";
import type { LegacyBulkSendSettings } from "./types";

/** Collaborators required to persist the obsolete bulk-send setting migration. */
export interface BulkSettingMigrationDependencies {
    readonly settings: LegacyBulkSendSettings;
    readonly log: LogFunction;
    readonly saveSettings: () => Promise<void>;
}

/**
 * Disable the removed automatic bulk chunk pre-send setting, retaining the
 * former notice text and persistence boundary.
 */
export async function migrateBulkSendSetting(dependencies: BulkSettingMigrationDependencies): Promise<void> {
    if (disableLegacyBulkChunkPreSend(dependencies.settings)) {
        dependencies.log($msg("moduleMigration.logBulkSendCorrupted"), LOG_LEVEL_NOTICE);
        await dependencies.saveSettings();
    }
}
