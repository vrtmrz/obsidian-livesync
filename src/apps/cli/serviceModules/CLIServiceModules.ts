import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import { StorageAccessManager } from "@vrtmrz/livesync-commonlib/compat/managers/StorageProcessingManager";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { FileAccessCLI } from "./FileAccessCLI";
import { ServiceFileAccessCLI } from "./ServiceFileAccessImpl";
import { ServiceDatabaseFileAccessCLI } from "./DatabaseFileAccess";
import { StorageEventManagerCLI } from "@/apps/cli/managers/StorageEventManagerCLI";
import type { ServiceModules } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { IgnoreRules } from "./IgnoreRules";
import { composeSharedServiceModules } from "@/apps/serviceModules/composeSharedServiceModules";

/**
 * Initialize service modules for CLI version
 * This is the CLI equivalent of ObsidianLiveSyncPlugin.initialiseServiceModules
 *
 * @param basePath - The base path of the vault directory
 * @param core - The LiveSyncBaseCore instance
 * @param services - The service hub
 * @returns ServiceModules containing all initialized service modules
 */
export function initialiseServiceModulesCLI(
    basePath: string,
    core: LiveSyncBaseCore<ServiceContext, never>,
    services: InjectableServiceHub<ServiceContext>,
    ignoreRules?: IgnoreRules,
    watchEnabled: boolean = false
): ServiceModules {
    const storageAccessManager = new StorageAccessManager();

    // CLI-specific file access using Node.js FileSystemAdapter
    const vaultAccess = new FileAccessCLI(basePath, {
        storageAccessManager: storageAccessManager,
        vaultService: services.vault,
        settingService: services.setting,
        APIService: services.API,
        pathService: services.path,
    });

    // CLI-specific storage event manager
    const storageEventManager = new StorageEventManagerCLI(
        basePath,
        core,
        {
            fileProcessing: services.fileProcessing,
            setting: services.setting,
            vaultService: services.vault,
            storageAccessManager: storageAccessManager,
            APIService: services.API,
        },
        ignoreRules,
        watchEnabled
    );

    // Close the file watcher during graceful shutdown so the process can exit cleanly.
    services.appLifecycle.onUnload.addHandler(async () => {
        await storageEventManager.close();
        return true;
    });

    // Storage access using CLI file system adapter
    const storageAccess = new ServiceFileAccessCLI({
        API: services.API,
        setting: services.setting,
        fileProcessing: services.fileProcessing,
        vault: services.vault,
        appLifecycle: services.appLifecycle,
        storageEventManager: storageEventManager,
        storageAccessManager: storageAccessManager,
        vaultAccess: vaultAccess,
    });

    // Database file access (platform-independent)
    const databaseFileAccess = new ServiceDatabaseFileAccessCLI({
        events: services.context.events,
        API: services.API,
        database: services.database,
        path: services.path,
        storageAccess: storageAccess,
        vault: services.vault,
    });

    const { fileHandler, rebuilder } = composeSharedServiceModules(services, databaseFileAccess, storageAccess);

    return {
        rebuilder,
        fileHandler,
        databaseFileAccess,
        storageAccess,
    };
}
