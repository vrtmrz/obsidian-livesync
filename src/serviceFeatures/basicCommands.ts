import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { fireAndForget } from "octagonal-wheels/promises";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";
import { $msg } from "@/common/translation";
import { copyFileDatabaseInfo, type FileDatabaseInfoCore } from "@/serviceFeatures/fileDatabaseInfo";

/**
 * Services required by the platform-independent command palette actions.
 *
 * The database report deliberately receives a structural adapter rather than
 * the whole host. This keeps the report helper independent from the core while
 * retaining the same local database, storage, settings, path, and UI sources.
 */
export type BasicCommandsHost = NecessaryServices<
    | "API"
    | "appLifecycle"
    | "control"
    | "database"
    | "fileProcessing"
    | "path"
    | "replication"
    | "setting"
    | "UI"
    | "vault",
    "storageAccess"
>;

function createFileDatabaseInfoCore(host: BasicCommandsHost): FileDatabaseInfoCore {
    const { services, serviceModules } = host;
    return {
        localDatabase: services.database.localDatabase,
        services: {
            path: services.path,
            UI: services.UI,
        },
        settings: services.setting.currentSettings(),
        storageAccess: serviceModules.storageAccess,
    };
}

/**
 * Register the platform-independent command palette actions.
 *
 * Registration remains tied to `onInitialise`, matching the legacy module's
 * timing and allowing hosts to compose the feature before the lifecycle runs.
 */
export function useBasicCommandsFeature(host: BasicCommandsHost): void {
    const { services } = host;
    const log = createInstanceLogFunction("SF:BasicCommands", services.API);

    services.appLifecycle.onInitialise.addHandler(() => {
        services.API.addCommand({
            id: "livesync-replicate",
            name: $msg("Sync now"),
            callback: async () => {
                await services.replication.replicateUserInitiated({
                    trigger: "manual",
                    progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
                    interaction: USER_INITIATED_REPLICATION_AUTHORITY,
                });
            },
        });

        services.API.addCommand({
            id: "livesync-dump",
            name: $msg("Copy database information for the active file"),
            checkCallback: (checking) => {
                const file = services.vault.getActiveFilePath();
                if (!file) return false;
                if (!checking) {
                    fireAndForget(() => copyFileDatabaseInfo(createFileDatabaseInfoCore(host), file));
                }
                return true;
            },
        });

        services.API.addCommand({
            id: "livesync-toggle",
            name: "Toggle LiveSync",
            callback: async () => {
                const settings = services.setting.currentSettings();
                if (settings.liveSync) {
                    settings.liveSync = false;
                    log("LiveSync Disabled.", LOG_LEVEL_NOTICE);
                } else {
                    settings.liveSync = true;
                    log("LiveSync Enabled.", LOG_LEVEL_NOTICE);
                }
                await services.control.applySettings();
                await services.setting.saveSettingData();
            },
        });

        services.API.addCommand({
            id: "livesync-suspendall",
            name: "Toggle All Sync.",
            callback: async () => {
                if (services.appLifecycle.isSuspended()) {
                    services.appLifecycle.setSuspended(false);
                    log("Self-hosted LiveSync resumed", LOG_LEVEL_NOTICE);
                } else {
                    services.appLifecycle.setSuspended(true);
                    log("Self-hosted LiveSync suspended", LOG_LEVEL_NOTICE);
                }
                await services.control.applySettings();
                await services.setting.saveSettingData();
            },
        });

        services.API.addCommand({
            id: "livesync-scan-files",
            name: "Scan storage and database again",
            checkCallback: (checking) => {
                if (!services.setting.currentSettings().useAdvancedMode) return false;
                if (!checking) {
                    fireAndForget(() => services.vault.scanVault(true));
                }
                return true;
            },
        });

        services.API.addCommand({
            id: "livesync-runbatch",
            name: $msg("Apply pending changes now"),
            callback: async () => {
                await services.fileProcessing.commitPendingFileEvents();
            },
        });

        services.API.addCommand({
            id: "livesync-abortsync",
            name: "Abort synchronization immediately",
            checkCallback: (checking) => {
                if (!services.setting.currentSettings().useAdvancedMode) return false;
                if (!checking) {
                    fireAndForget(() => services.replication.stopActiveTransfer());
                }
                return true;
            },
        });

        return Promise.resolve(true);
    });
}
