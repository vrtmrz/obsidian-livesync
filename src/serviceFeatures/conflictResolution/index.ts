import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import type { InjectableConflictService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableConflictService";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { createConflictCheckingHandlers } from "./checker";
import { createConflictResolutionOperations } from "./operations";

type ConflictResolutionServices = NecessaryServices<
    "API" | "appLifecycle" | "conflict" | "database" | "replication" | "setting" | "vault",
    "databaseFileAccess" | "fileHandler" | "storageAccess"
>;

export type ConflictResolutionHost = ConflictResolutionServices & {
    readonly services: ConflictResolutionServices["services"] & {
        readonly conflict: InjectableConflictService<ServiceContext>;
    };
};

/** Compose the host-neutral conflict checker and resolver handlers. */
export function useConflictResolutionFeature(host: ConflictResolutionHost): void {
    const { services, serviceModules } = host;
    const log = createInstanceLogFunction("SF:ConflictResolution", services.API);
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
}

export { createConflictCheckingHandlers } from "./checker";
export type { ConflictCheckingDependencies, ConflictCheckingHandlers } from "./checker";
export type {
    ConflictResolutionOperations,
    ConflictResolutionOperationsDependencies,
    ConflictResolutionSettings,
} from "./operations";
export { createConflictResolutionOperations } from "./operations";
