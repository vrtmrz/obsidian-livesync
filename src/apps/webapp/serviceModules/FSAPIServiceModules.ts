import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";

import { StorageAccessManager } from "@vrtmrz/livesync-commonlib/compat/managers/StorageProcessingManager";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { FileAccessFSAPI } from "./FileAccessFSAPI";
import { ServiceFileAccessFSAPI } from "./ServiceFileAccessImpl";
import { ServiceDatabaseFileAccessFSAPI } from "./DatabaseFileAccess";
import { StorageEventManagerFSAPI } from "@/apps/webapp/managers/StorageEventManagerFSAPI";
import type { ServiceModules } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { composeSharedServiceModules } from "@/apps/serviceModules/composeSharedServiceModules";

export interface FSAPIServiceModules extends ServiceModules {
    vaultAccess: FileAccessFSAPI;
    storageEventManager: StorageEventManagerFSAPI;
}

/**
 * Initialize service modules for FileSystem API webapp version
 * This is the webapp equivalent of ObsidianLiveSyncPlugin.initialiseServiceModules
 *
 * @param rootHandle - The root FileSystemDirectoryHandle for the vault
 * @param core - The LiveSyncBaseCore instance
 * @param services - The service hub
 * @returns ServiceModules containing all initialized service modules
 */
export function initialiseServiceModulesFSAPI(
    rootHandle: FileSystemDirectoryHandle,
    core: LiveSyncBaseCore<ServiceContext, never>,
    services: InjectableServiceHub<ServiceContext>
): FSAPIServiceModules {
    const storageAccessManager = new StorageAccessManager();

    // FileSystem API-specific file access
    const vaultAccess = new FileAccessFSAPI(rootHandle, {
        storageAccessManager: storageAccessManager,
        vaultService: services.vault,
        settingService: services.setting,
        APIService: services.API,
        pathService: services.path,
    });

    // FileSystem API-specific storage event manager
    const storageEventManager = new StorageEventManagerFSAPI(rootHandle, core, {
        fileProcessing: services.fileProcessing,
        setting: services.setting,
        vaultService: services.vault,
        storageAccessManager: storageAccessManager,
        APIService: services.API,
    });

    // Storage access using FileSystem API adapter
    const storageAccess = new ServiceFileAccessFSAPI({
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
    const databaseFileAccess = new ServiceDatabaseFileAccessFSAPI({
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
        vaultAccess,
        storageEventManager,
    };
}
