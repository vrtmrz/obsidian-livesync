import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { DatabaseFileAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/DatabaseFileAccess";
import type { ServiceModules } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { StorageAccess } from "@vrtmrz/livesync-commonlib/compat/interfaces/StorageAccess";
import { ServiceRebuilder } from "@vrtmrz/livesync-commonlib/compat/serviceModules/Rebuilder";
import { ServiceFileHandler } from "@/serviceModules/FileHandler";
import { createFileReflectionProvenance } from "@/serviceModules/FileReflectionProvenance";

/** Compose the service modules shared by app hosts after their storage setup. */
export function composeSharedServiceModules(
    services: InjectableServiceHub<ServiceContext>,
    databaseFileAccess: DatabaseFileAccess,
    storageAccess: StorageAccess
): Pick<ServiceModules, "fileHandler" | "rebuilder"> {
    const fileHandler = new ServiceFileHandler({
        events: services.context.events,
        API: services.API,
        databaseFileAccess,
        conflict: services.conflict,
        setting: services.setting,
        fileProcessing: services.fileProcessing,
        vault: services.vault,
        path: services.path,
        replication: services.replication,
        storageAccess,
        fileReflectionProvenance: createFileReflectionProvenance(services.keyValueDB),
    });

    const rebuilder = new ServiceRebuilder({
        path: services.path,
        events: services.context.events,
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
        fileHandler,
        fileProcessing: services.fileProcessing,
        storageAccess,
        control: services.control,
    });

    return { rebuilder, fileHandler };
}
