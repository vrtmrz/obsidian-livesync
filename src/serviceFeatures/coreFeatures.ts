import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { useTargetFilters } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/targetFilter";
import { useRemoteConfigurationMigration } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/remoteConfig";
import { usePrepareDatabaseForUse } from "@vrtmrz/livesync-commonlib/compat/serviceFeatures/prepareDatabaseForUse";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { useBasicCommandsFeature } from "./basicCommands";
import { useConflictResolutionFeature } from "./conflictResolution";
import { createReplicationFeature } from "./replication";
import type { ReflectionRecoveryView } from "./replication/reflectionRecoveryState";
import { useReplicationScheduling, type ReplicationSchedulingControl } from "./replicationScheduling";

/** Focused feature views available while a host composes its own features and UI. */
export interface LiveSyncCoreFeatureViews {
    readonly replicationScheduling: ReplicationSchedulingControl;
    readonly reflectionRecovery: ReflectionRecoveryView;
}

export type HostFeatureInitialiser<TCore> = (core: TCore, views: LiveSyncCoreFeatureViews) => void;

/** Register shared features which precede host-specific composition. */
export function initialiseSharedCoreFeatures<T extends ServiceContext, TCommands extends IMinimumLiveSyncCommands>(
    core: LiveSyncBaseCore<T, TCommands>
): Pick<LiveSyncCoreFeatureViews, "replicationScheduling"> {
    useConflictResolutionFeature({
        services: core.services,
        serviceModules: core.serviceModules,
        log: createInstanceLogFunction("SF:ConflictResolution", core.services.API),
    });
    useTargetFilters(core);
    usePrepareDatabaseForUse(core);
    useRemoteConfigurationMigration(core);
    return Object.freeze({ replicationScheduling: useReplicationScheduling(core) });
}

/**
 * Prepare views before host composition, then register the remaining shared handlers.
 * Equal-priority replication handlers must follow host features and add-ons. Legacy Module
 * binding remains with Core and follows this operation.
 */
export function composeCoreFeatures<T extends ServiceContext, TCommands extends IMinimumLiveSyncCommands>(
    core: LiveSyncBaseCore<T, TCommands>,
    initialiseHostFeatures: HostFeatureInitialiser<LiveSyncBaseCore<T, TCommands>>,
    initialiseAddOns: () => void
): void {
    const replication = createReplicationFeature(core);
    const views: LiveSyncCoreFeatureViews = {
        ...core.initialiseServiceFeatures(),
        reflectionRecovery: replication.recovery,
    };
    initialiseHostFeatures(core, views);
    initialiseAddOns();
    replication.register();
    useBasicCommandsFeature(core);
}
