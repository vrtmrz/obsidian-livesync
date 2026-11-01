import {
    createServiceFeature,
    type NecessaryServices,
} from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import type { LogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { InjectableServiceHub } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableServiceHub";
import { createConflictCheckingHandlers } from "./checker";
import { createConflictResolutionOperations } from "./operations";

export type ConflictResolutionHost = NecessaryServices<
    "appLifecycle" | "conflict" | "database" | "replication" | "setting" | "vault",
    "databaseFileAccess" | "fileHandler" | "storageAccess",
    InjectableServiceHub
> & {
    readonly log: LogFunction;
};

/** Compose the host-neutral conflict handlers with the host's borrowed logger. */
export const useConflictResolutionFeature = createServiceFeature((host: ConflictResolutionHost): void => {
    const { services, serviceModules, log } = host;
    const operations = createConflictResolutionOperations({
        events: services.context.events,
        databaseFileAccess: serviceModules.databaseFileAccess,
        fileHandler: serviceModules.fileHandler,
        localDatabase: () => services.database.localDatabase,
        conflict: services.conflict,
        replication: services.replication,
        appLifecycle: services.appLifecycle,
        vault: services.vault,
        storageAccess: serviceModules.storageAccess,
        currentSettings: () => services.setting.currentSettings(),
        log,
    });
    const checking = createConflictCheckingHandlers({
        conflict: services.conflict,
        conflictProcessQueueCount: services.conflict.conflictProcessQueueCount,
        cancelActiveResolution: operations.cancelActiveResolution,
        currentSettings: () => services.setting.currentSettings(),
        vault: services.vault,
        log,
    });

    services.conflict.queueCheckForIfOpen.setHandler(checking.queueCheckForIfOpen);
    services.conflict.queueCheckFor.setHandler(checking.queueCheckFor);
    services.conflict.ensureAllProcessed.setHandler(checking.ensureAllProcessed);
    services.conflict.resolveByDeletingRevision.setHandler(operations.resolveByDeletingRevision);
    services.conflict.resolve.setHandler(operations.resolve);
    services.conflict.resolveByNewest.setHandler(operations.resolveByNewest);
    services.conflict.resolveAllConflictedFilesByNewerOnes.setHandler(operations.resolveAllConflictedFilesByNewerOnes);
});

export { createConflictCheckingHandlers } from "./checker";
export type { ConflictCheckingDependencies, ConflictCheckingHandlers } from "./checker";
export type {
    ConflictResolutionOperations,
    ConflictResolutionOperationsDependencies,
    ConflictResolutionSettings,
} from "./operations";
export { createConflictResolutionOperations } from "./operations";
