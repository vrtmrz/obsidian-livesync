import type { CustomisationSyncContextDependencies } from "./customisationSyncContext.ts";

/** Minimal inert dependency set for focused Customisation Sync unit tests. */
export function createCustomisationSyncTestDependencies(
    overrides: Partial<CustomisationSyncContextDependencies> = {}
): CustomisationSyncContextDependencies {
    const defaults = {
        getSettings: () => ({
            usePluginSync: true,
            usePluginSyncV2: true,
            usePluginEtc: true,
            pluginSyncExtendedSetting: {},
            autoSweepPlugins: false,
            autoSweepPluginsPeriodic: false,
            watchInternalFileChanges: false,
            notifyPluginOrSettingUpdated: false,
        }),
        getLocalDatabase: () => ({}),
        storageAccess: {},
        path: {},
        log: () => undefined,
        getConfigDir: () => ".config-dir",
        getDeviceAndVaultName: () => "device-a",
        setDeviceAndVaultName: () => undefined,
        saveSettingData: () => Promise.resolve(),
        applySettings: () => Promise.resolve(),
        replicateUserInitiated: () => Promise.resolve(),
        askString: () => Promise.resolve(false),
        isReady: () => true,
        isSuspended: () => false,
        askRestart: () => undefined,
        createPeriodicProcessor: () => ({
            enable: () => undefined,
            disable: () => undefined,
        }),
        listFiles: () => Promise.resolve({ files: [], folders: [] }),
        resolveJsonConflict: () => Promise.resolve(false),
        selectTextFile: () => Promise.resolve(false),
        reloadPlugin: () => Promise.resolve(),
        getFallbackDeviceName: () => "desktop-test",
        showConfigurationNotice: () => undefined,
        hideConfigurationNotice: () => undefined,
        getUIControl: () => undefined,
        ownsLocalFile: () => true,
        ownsLocalDocument: () => true,
        publishScanCount: () => undefined,
    } as unknown as CustomisationSyncContextDependencies;
    return { ...defaults, ...overrides };
}
