import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, type LOG_LEVEL } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { fireAndForget, getFileRegExp, sendSignal } from "@vrtmrz/livesync-commonlib/compat/common/utils";
import {
    hiddenFilesEventCount,
    hiddenFilesProcessingCount,
} from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import { getObsidianCommunityPluginManager } from "@/common/obsidianCommunityPlugins.ts";
import { JsonResolveModal } from "@/features/HiddenFileCommon/JsonResolveModal.ts";
import type {
    HiddenFileSyncContextDependencies,
    HiddenFileSyncProgress,
} from "@/features/HiddenFileSync/hiddenFileSyncContext.ts";
import type { HiddenFileSyncJsonResolution } from "@/features/HiddenFileSync/hiddenFileSyncConflictResolution.ts";
import { MARK_DONE } from "@/modules/features/ModuleLog.ts";
import type { LiveSyncCore } from "@/main.ts";

const HIDDEN_FILE_NOTICE_GROUP = "hidden-file-changes";
const HIDDEN_FILE_NOTICE_DURATION_MS = 20_000;

export type HiddenFileSyncObsidianPolicies = Pick<HiddenFileSyncContextDependencies, "ownsLocalFile">;

/** Adapt the Obsidian host to the narrow capabilities used by Hidden File Sync. */
export function createHiddenFileSyncObsidianDependencies(
    host: LiveSyncCore,
    policies: HiddenFileSyncObsidianPolicies
): HiddenFileSyncContextDependencies {
    const { services, serviceModules } = host;
    const app = services.context.app;
    const log = createInstanceLogFunction("HiddenFileSyncContext", services.API);
    let noticeIndex = 0;
    const activeConflictDialogs = new Map<string, symbol>();

    const createProgress = (prefix: string = "", level: LOG_LEVEL = LOG_LEVEL_NOTICE): HiddenFileSyncProgress => {
        const key = `keepalive-progress-${noticeIndex++}`;
        return {
            log: (message) => log(prefix + message, level, key),
            once: (message) => log(prefix + message, level),
            done: (message: string = "Done") => log(prefix + message + MARK_DONE, level, key),
        };
    };

    const resolveJsonConflict: HiddenFileSyncContextDependencies["resolveJsonConflict"] = (path, docs, apply) =>
        new Promise<boolean>((resolve, reject) => {
            // Replacing a dialogue for the same path must close the old instance.
            const conflictPath = path;
            const token = Symbol(conflictPath);
            let settled = false;
            sendSignal(`cancel-internal-conflict:${conflictPath}`);
            activeConflictDialogs.set(conflictPath, token);
            const modal = new JsonResolveModal(app, path, docs, async (keepRevision, mergedText) => {
                if (settled) return;
                settled = true;
                const resolution: HiddenFileSyncJsonResolution = { keepRevision, mergedText };
                try {
                    resolve(await apply(resolution));
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                } finally {
                    if (activeConflictDialogs.get(conflictPath) === token) {
                        activeConflictDialogs.delete(conflictPath);
                    }
                }
            });
            modal.open();
        });

    const showConfigurationChangeNotice = (updatedFolders: readonly string[]) => {
        const noticeGroups = services.context.noticeGroups;
        let hasNoticeItems = false;
        try {
            const pluginManager = getObsidianCommunityPluginManager(app);
            const enabledPluginManifests = pluginManager.manifests.filter((manifest) =>
                pluginManager.enabledPlugins.has(manifest.id)
            );
            const modifiedManifests = enabledPluginManifests.filter((manifest) =>
                updatedFolders.includes(manifest.dir ?? "")
            );
            for (const manifest of modifiedManifests) {
                const pluginId = manifest.id;
                const pluginName = manifest.name;
                const itemKey = `plugin:${pluginId}`;
                noticeGroups.setItem(HIDDEN_FILE_NOTICE_GROUP, itemKey, {
                    message: `Files in ${pluginName} were updated.`,
                    action: {
                        label: `Reload ${pluginName}`,
                        onSelect: () => {
                            fireAndForget(async () => {
                                const logKey = `plugin-reload-${pluginId}`;
                                log(`Unloading plugin: ${pluginName}`, LOG_LEVEL_NOTICE, logKey);
                                await pluginManager.unloadPlugin(pluginId);
                                await pluginManager.loadPlugin(pluginId);
                                log(`Plugin reloaded: ${pluginName}`, LOG_LEVEL_NOTICE, logKey);
                                noticeGroups.removeItem(HIDDEN_FILE_NOTICE_GROUP, itemKey);
                            });
                        },
                    },
                });
                hasNoticeItems = true;
            }
        } catch (error) {
            log("Error on checking plugin status.");
            log(error, LOG_LEVEL_VERBOSE);
        }

        if (updatedFolders.includes(services.API.getSystemConfigDir())) {
            if (!services.appLifecycle.isReloadingScheduled()) {
                noticeGroups.setItem(HIDDEN_FILE_NOTICE_GROUP, "restart", {
                    message: "Other Obsidian settings files were updated.",
                    action: {
                        label: "Schedule an Obsidian restart",
                        onSelect: () => {
                            services.appLifecycle.scheduleRestart();
                            noticeGroups.removeItem(HIDDEN_FILE_NOTICE_GROUP, "restart");
                        },
                    },
                });
                hasNoticeItems = true;
            } else {
                noticeGroups.removeItem(HIDDEN_FILE_NOTICE_GROUP, "restart");
            }
        }
        if (hasNoticeItems) {
            noticeGroups.finish(HIDDEN_FILE_NOTICE_GROUP, { durationMs: HIDDEN_FILE_NOTICE_DURATION_MS });
        }
    };

    return {
        getSettings: () => services.setting.settings,
        getLocalDatabase: () => services.database.localDatabase,
        getKeyValueDatabase: () => services.keyValueDB.kvDB,
        storageAccess: serviceModules.storageAccess,
        databaseFileAccess: serviceModules.databaseFileAccess,
        path: services.path,
        log,
        createProgress,
        createPeriodicProcessor: (process) => new PeriodicProcessor(host, process),
        isReady: () => services.appLifecycle.isReady(),
        isSuspended: () => services.appLifecycle.isSuspended(),
        isDatabaseReady: () => services.database.isDatabaseReady(),
        isIgnoredByIgnoreFile: async (path) => await services.vault.isIgnoredByIgnoreFile(path),
        getConfigDir: () => services.API.getSystemConfigDir(),
        getRootPath: () => app.vault.getRoot().path,
        listFiles: async (path) => await app.vault.adapter.list(path),
        getFileRegExp: (key) => getFileRegExp(services.setting.settings, key),
        applySettings: async (partial, saveImmediately) =>
            await services.setting.applyPartial(partial, saveImmediately),
        setSyncInternalFilesEnabled: (enabled) => {
            services.setting.settings.syncInternalFiles = enabled;
        },
        resolveJsonConflict,
        showConfigurationChangeNotice,
        hideConfigurationChangeNotice: () => {
            services.context.noticeGroups.hide(HIDDEN_FILE_NOTICE_GROUP);
        },
        closeJsonConflictDialogs: () => {
            for (const path of activeConflictDialogs.keys()) {
                sendSignal(`cancel-internal-conflict:${path}`);
            }
            activeConflictDialogs.clear();
        },
        publishActivity: (eventCount, processingCount) => {
            hiddenFilesEventCount.value = eventCount;
            hiddenFilesProcessingCount.value = processingCount;
        },
        ownsLocalFile: (path) => policies.ownsLocalFile(path),
    };
}
