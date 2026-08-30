import { NO_INTERACTION } from "@vrtmrz/livesync-commonlib/replication";
import { clearHandlers } from "@vrtmrz/livesync-commonlib/compat/replication/SyncParamsHandler";
import { UnresolvedErrorManager } from "@vrtmrz/livesync-commonlib/compat/services/base/UnresolvedErrorManager";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { fireAndForget } from "octagonal-wheels/promises";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { createAutomaticReplicationTriggers } from "./automaticTriggers";
import { createCentralCompatibilityRecovery } from "./centralCompatibilityRecovery";
import { createOnlineReplicationPreflight, createSecuritySeedPreflight } from "./preflight";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";

type LocalApplicationActivityOwner = {
    runBoundedLocalApplicationActivity<T>(task: () => T | PromiseLike<T>, options?: { label?: string }): Promise<T>;
};

function ownsLocalApplicationActivity(value: object): value is LocalApplicationActivityOwner {
    return (
        "runBoundedLocalApplicationActivity" in value && typeof value.runBoundedLocalApplicationActivity === "function"
    );
}

/**
 * Compose result application, automatic triggers, preflight, and central
 * compatibility recovery around the existing typed Services.
 *
 * Registration order is observable for equal-priority handlers. The host must
 * call this after host serviceFeatures and add-ons are composed, but before
 * legacy modules are bound. This preserves the former ModuleReplicator
 * lifecycle-handler order without retaining a public module identity.
 */
export function useReplicationFeature<TContext extends ServiceContext, TCommands extends IMinimumLiveSyncCommands>(
    core: LiveSyncBaseCore<TContext, TCommands>
): void {
    const { services } = core;
    // Obsidian adds an application-activity owner to its ReplicatorService.
    // Generic hosts retain the former direct-execution fallback.
    const localApplicationActivityOwner = ownsLocalApplicationActivity(services.replicator)
        ? services.replicator
        : undefined;
    const resultProcessor = new ReplicateResultProcessor({
        currentSettings: () => services.setting.currentSettings(),
        getKeyValueDB: () => services.keyValueDB.kvDB,
        getLocalDatabase: () => core.localDatabase,
        requestActiveReplicatorRetirement: () => {
            // Do not await a retirement transition from result application: it
            // may be draining the replication work which delivered this item.
            fireAndForget(() => services.replicator.onCloseActiveReplication());
        },
        runLocalApplicationActivity: async (task, options) =>
            localApplicationActivityOwner
                ? await localApplicationActivityOwner.runBoundedLocalApplicationActivity(task, options)
                : await task(),
        services: {
            appLifecycle: services.appLifecycle,
            path: services.path,
            replication: services.replication,
            vault: services.vault,
        },
    });
    const unresolvedErrorManager = new UnresolvedErrorManager(services.appLifecycle, services.context.events);
    const initialiseAutomaticReplicationTriggers = createAutomaticReplicationTriggers({
        currentSettings: () => services.setting.currentSettings(),
        isSuspended: () => services.appLifecycle.isSuspended(),
        replicateDatabaseEvent: () =>
            services.replication.replicateUnattendedByEvent({
                trigger: "database-event",
                interaction: NO_INTERACTION,
            }),
        reprocessStoredDocuments: () => resultProcessor.reprocessStoredDocuments(),
        resumeResultApplication: () => resultProcessor.resume(),
        suspendResultApplication: () => resultProcessor.suspend(),
    });
    const preflightContext = {
        services: {
            API: services.API,
            replicator: services.replicator,
            setting: services.setting,
        },
    };
    const onlinePreflight = createOnlineReplicationPreflight(unresolvedErrorManager, preflightContext);
    const securitySeedPreflight = createSecuritySeedPreflight(unresolvedErrorManager, preflightContext);
    const centralCompatibilityRecovery = createCentralCompatibilityRecovery({
        confirm: core.confirm,
        getLocalDatabase: () => core.localDatabase,
        rebuilder: core.rebuilder,
        services: {
            API: services.API,
            appLifecycle: services.appLifecycle,
            replicator: services.replicator,
            tweakValue: services.tweakValue,
        },
    });

    services.replicator.onBeforeReplicatorPublication.addHandler(() => {
        // Key-derivation handlers belong to the candidate which is about to
        // become active; discard callbacks retained by the previous owner.
        clearHandlers();
        return Promise.resolve(true);
    });
    services.databaseEvents.onDatabaseInitialised.addHandler(() => {
        fireAndForget(() => resultProcessor.restoreFromSnapshotOnce());
        return Promise.resolve(true);
    });
    services.appLifecycle.onSettingLoaded.addHandler(initialiseAutomaticReplicationTriggers);
    services.replication.parseSynchroniseResult.addHandler((documents) => {
        resultProcessor.enqueueAll(documents);
        return Promise.resolve(true);
    });
    services.replication.onBeforeReplicate.addHandler(onlinePreflight, 10);
    services.replication.onPrepareCentralRemoteReplication.addHandler(securitySeedPreflight);
    services.replication.onBeforeReplicate.addHandler(async () => {
        await resultProcessor.restoreFromSnapshotOnce();
        unresolvedErrorManager.clearErrors();
        return true;
    }, 100);
    services.replication.onReplicationFailed.addHandler(centralCompatibilityRecovery.handleReplicationFailure);
}
