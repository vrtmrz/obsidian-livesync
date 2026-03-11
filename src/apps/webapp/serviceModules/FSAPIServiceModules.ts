import type { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import { ServiceRebuilder } from "@lib/serviceModules/Rebuilder";

import { StorageAccessManager } from "@lib/managers/StorageProcessingManager";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { FileAccessFSAPI } from "./FileAccessFSAPI";
import { ServiceFileAccessFSAPI } from "./ServiceFileAccessImpl";
import { ServiceDatabaseFileAccessFSAPI } from "./DatabaseFileAccess";
import { StorageEventManagerFSAPI } from "../managers/StorageEventManagerFSAPI";
import type { ServiceModules } from "@lib/interfaces/ServiceModule";
import { ServiceFileHandler } from "@/serviceModules/FileHandler";

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
    core: LiveSyncBaseCore<ServiceContext, any>,
    services: InjectableServiceHub<ServiceContext>
): ServiceModules {
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
        API: services.API,
        database: services.database,
        path: services.path,
        storageAccess: storageAccess,
        vault: services.vault,
    });

    // File handler (platform-independent)
    const fileHandler = new (ServiceFileHandler as any)({
        API: services.API,
        databaseFileAccess: databaseFileAccess,
        conflict: services.conflict,
        setting: services.setting,
        fileProcessing: services.fileProcessing,
        vault: services.vault,
        path: services.path,
        replication: services.replication,
        storageAccess: storageAccess,
    });

    // Rebuilder (platform-independent)
    const rebuilder = new ServiceRebuilder({
        API: services.API,
        database: services.database,
        appLifecycle: services.appLifecycle,
        setting: services.setting,
        remote: services.remote,
        databaseEvents: services.databaseEvents,
        replication: services.replication,
        replicator: services.replicator,
        UI: services.UI,
        vault: services.vault,
        fileHandler: fileHandler,
        storageAccess: storageAccess,
        control: services.control,
    });

    return {
        rebuilder,
        fileHandler,
        databaseFileAccess,
        storageAccess,
    };
}
