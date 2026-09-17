import {
    CANCELLED,
    LEAVE_TO_SUBSEQUENT,
    LOG_LEVEL_NOTICE,
    type FilePath,
    type FilePathWithPrefix,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import { pluginScanningCount } from "@vrtmrz/livesync-commonlib/compat/mock_and_interop/stores";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";

import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import { getObsidianCommunityPluginManager } from "@/common/obsidianCommunityPlugins.ts";
import { Platform } from "@/deps.ts";
import type { CustomisationSyncContextDependencies } from "@/features/ConfigSync/customisationSyncContext.ts";
import { JsonResolveModal } from "@/features/HiddenFileCommon/JsonResolveModal.ts";
import { ConflictResolveModal } from "@/modules/features/InteractiveConflictResolving/ConflictResolveModal.ts";
import type { LiveSyncCore } from "@/main.ts";

const UPDATED_CONFIGURATION_NOTICE_KEY = "config-sync:updated-configuration";

export type CustomisationSyncObsidianPolicies = Pick<
    CustomisationSyncContextDependencies,
    "getUIControl" | "ownsLocalDocument" | "ownsLocalFile"
>;

function fallbackDeviceName(): string {
    let name: string;
    if (Platform.isAndroidApp) {
        name = "android-app";
    } else if (Platform.isIosApp) {
        name = "ios";
    } else if (Platform.isMacOS) {
        name = "macos";
    } else if (Platform.isMobileApp) {
        name = "mobile-app";
    } else if (Platform.isMobile) {
        name = "mobile";
    } else if (Platform.isSafari) {
        name = "safari";
    } else if (Platform.isDesktop) {
        name = "desktop";
    } else if (Platform.isDesktopApp) {
        name = "desktop-app";
    } else {
        name = "unknown";
    }
    return name + Math.random().toString(36).slice(-4);
}

/**
 * Adapt the Obsidian host to the narrow capabilities used by Customisation Sync.
 *
 * Runtime state and synchronisation policy remain in the context. Obsidian UI,
 * host lifecycle, and compatibility telemetry stay at this composition edge.
 */
export function createCustomisationSyncObsidianDependencies(
    host: LiveSyncCore,
    policies: CustomisationSyncObsidianPolicies
): CustomisationSyncContextDependencies {
    const { services } = host;
    const app = services.context.app;
    const log = createInstanceLogFunction("CustomisationSyncContext", services.API);

    return {
        getSettings: () => services.setting.settings,
        getLocalDatabase: () => services.database.localDatabase,
        storageAccess: host.serviceModules.storageAccess,
        path: services.path,
        log,
        getConfigDir: () => services.API.getSystemConfigDir(),
        getDeviceAndVaultName: () => services.setting.getDeviceAndVaultName(),
        setDeviceAndVaultName: (name) => services.setting.setDeviceAndVaultName(name),
        saveSettingData: async () => await services.setting.saveSettingData(),
        applySettings: async (partial, saveImmediately) =>
            await services.setting.applyPartial(partial, saveImmediately),
        replicateUserInitiated: async (options) => await services.replication.replicateUserInitiated(options),
        askString: async (title, key, placeholder) => await services.UI.confirm.askString(title, key, placeholder),
        isReady: () => services.appLifecycle.isReady(),
        isSuspended: () => services.appLifecycle.isSuspended(),
        askRestart: () => services.appLifecycle.askRestart(),
        createPeriodicProcessor: (process) => new PeriodicProcessor(host, process),
        listFiles: async (path) => await app.vault.adapter.list(path),
        resolveJsonConflict: async (path, files, remoteName, apply) =>
            await new Promise<boolean>((resolve) => {
                const modal = new JsonResolveModal(
                    app,
                    path,
                    files,
                    async (_keep, result) => {
                        if (result == null) {
                            resolve(false);
                            return;
                        }
                        resolve(await apply(result));
                    },
                    "Local",
                    remoteName,
                    "B",
                    true,
                    true,
                    "Difference between local and remote"
                );
                modal.open();
            }),
        selectTextFile: async (path, diffResult, remoteName) => {
            const modal = new ConflictResolveModal(app, path, diffResult, true, remoteName);
            modal.open();
            const result = await modal.waitForResult();
            if (result === CANCELLED || result === LEAVE_TO_SUBSEQUENT) return false;
            if (result === "A" || result === "B") return result;
            return false;
        },
        reloadPlugin: async (configDir, pluginName) => {
            const pluginManager = getObsidianCommunityPluginManager(app);
            const pluginManifest = pluginManager.manifests.find(
                (manifest) =>
                    pluginManager.enabledPlugins.has(manifest.id) &&
                    manifest.dir == `${configDir}/plugins/${pluginName}`
            );
            if (!pluginManifest) return;

            const logKey = "plugin-reload-" + pluginManifest.id;
            log(`Unloading plugin: ${pluginManifest.name}`, LOG_LEVEL_NOTICE, logKey);
            await pluginManager.unloadPlugin(pluginManifest.id);
            await pluginManager.loadPlugin(pluginManifest.id);
            log(`Plugin reloaded: ${pluginManifest.name}`, LOG_LEVEL_NOTICE, logKey);
        },
        getFallbackDeviceName: fallbackDeviceName,
        showConfigurationNotice: (openDialog) => {
            const fragment = createFragment((documentFragment) => {
                documentFragment.createSpan(undefined, (span) => {
                    span.appendText("Some configuration has been arrived, Press ");
                    span.appendChild(
                        span.createEl("a", undefined, (anchor) => {
                            anchor.text = "HERE";
                            anchor.addEventListener("click", openDialog);
                        })
                    );
                    span.appendText(" to open the config sync dialog , or press elsewhere to dismiss this message.");
                });
            });
            services.context.notices.show(UPDATED_CONFIGURATION_NOTICE_KEY, fragment, { durationMs: 20_000 });
        },
        hideConfigurationNotice: () => services.context.notices.hide(UPDATED_CONFIGURATION_NOTICE_KEY),
        getUIControl: policies.getUIControl,
        ownsLocalFile: (path: FilePath) => policies.ownsLocalFile(path),
        ownsLocalDocument: (path: FilePathWithPrefix) => policies.ownsLocalDocument(path),
        publishScanCount: (count) => {
            pluginScanningCount.value = count;
        },
    };
}
