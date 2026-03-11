import type { InjectableServiceHub } from "@lib/services/implements/injectable/InjectableServiceHub";
import { ServiceRebuilder } from "@lib/serviceModules/Rebuilder";
import { ServiceFileHandler } from "../../../serviceModules/FileHandler";
import { StorageAccessManager } from "@lib/managers/StorageProcessingManager";
import type { LiveSyncBaseCore } from "../../../LiveSyncBaseCore";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import { FileAccessCLI } from "./FileAccessCLI";
import { ServiceFileAccessCLI } from "./ServiceFileAccessImpl";
import { ServiceDatabaseFileAccessCLI } from "./DatabaseFileAccess";
import { StorageEventManagerCLI } from "../managers/StorageEventManagerCLI";
import type { ServiceModules } from "@lib/interfaces/ServiceModule";

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
    core: LiveSyncBaseCore<ServiceContext, any>,
    services: InjectableServiceHub<ServiceContext>
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
    const storageEventManager = new StorageEventManagerCLI(basePath, core, {
        fileProcessing: services.fileProcessing,
        setting: services.setting,
        vaultService: services.vault,
        storageAccessManager: storageAccessManager,
        APIService: services.API,
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
