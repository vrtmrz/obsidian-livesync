import { NO_INTERACTION } from "@vrtmrz/livesync-commonlib/replication";
import { clearHandlers } from "@vrtmrz/livesync-commonlib/compat/replication/SyncParamsHandler";
import { UnresolvedErrorManager } from "@vrtmrz/livesync-commonlib/compat/services/base/UnresolvedErrorManager";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { fireAndForget } from "octagonal-wheels/promises";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import { EVENT_APPLICATION_READY, EVENT_VAULT_REFLECTION_FAILED } from "@/common/events";
import { createAutomaticReplicationTriggers } from "./automaticTriggers";
import { createCentralCompatibilityRecovery } from "./centralCompatibilityRecovery";
import { createOnlineReplicationPreflight, createSecuritySeedPreflight } from "./preflight";
import { ReplicateResultProcessor, type ReflectionRecoveryView } from "./ReplicateResultProcessor";
import { LOG_LEVEL_VERBOSE } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import {
    canRetainFailedReflection,
    canRetryReflectionResource,
    inspectReflection,
    reconcileScannedDocument,
} from "./replicateResultContext";

type LocalApplicationActivityOwner = {
    runBoundedLocalApplicationActivity<T>(task: () => T | PromiseLike<T>, options?: { label?: string }): Promise<T>;
};

function ownsLocalApplicationActivity(value: object): value is LocalApplicationActivityOwner {
    return (
        "runBoundedLocalApplicationActivity" in value && typeof value.runBoundedLocalApplicationActivity === "function"
    );
}

/**
 * Prepare result application, automatic triggers, preflight, and central
 * compatibility recovery without registering their handlers.
 *
 * Registration order is observable for equal-priority handlers. The host must
 * call the returned `register` after host serviceFeatures and add-ons are composed, but before
 * legacy modules are bound, so lifecycle handlers observe the required order.
 */
export function createReplicationFeature<TContext extends ServiceContext, TCommands extends IMinimumLiveSyncCommands>(
    core: LiveSyncBaseCore<TContext, TCommands>
) {
    const { services } = core;
    const recoveryEnabled = core.startupDatabaseOptions?.recoverFileReflectionFailures === true;
    // Obsidian adds an application-activity owner to its ReplicatorService.
    // Generic hosts retain the former direct-execution fallback.
    const localApplicationActivityOwner = ownsLocalApplicationActivity(services.replicator)
        ? services.replicator
        : undefined;
    const discardSnapshotOnReset = core.startupDatabaseOptions?.discardReplicationResultSnapshotOnReset ?? false;
    const reflectionPolicyContext = { recoveryEnabled, setting: services.setting };
    const reflectionInspectionContext = {
        setting: services.setting,
        conflict: services.conflict,
        path: services.path,
        // Preserve the former callbacks' deferred lookup of reflection service modules.
        get storageAccess() {
            return core.serviceModules.storageAccess;
        },
        getLocalDatabase: () => core.localDatabase,
        get fileHandler() {
            return core.serviceModules.fileHandler;
        },
        API: services.API,
    };
    const scannedDocumentContext = {
        scannerHost: core,
        path: services.path,
        get storageAccess() {
            return core.serviceModules.storageAccess;
        },
        API: services.API,
    };
    const resultProcessor = new ReplicateResultProcessor(
        {
            onVaultReflectionFailure: () => services.context.events.emitEvent(EVENT_VAULT_REFLECTION_FAILED),
            canRetainFailedReflection: () => canRetainFailedReflection(reflectionPolicyContext),
            canRetryResource: (resource) => canRetryReflectionResource(reflectionPolicyContext, resource),
            inspectReflection: (entry, source) => inspectReflection(reflectionInspectionContext, entry, source),
            reconcileScannedDocument: (entry, operation) =>
                reconcileScannedDocument(scannedDocumentContext, entry, operation),
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
                database: services.database,
                path: services.path,
                replication: services.replication,
                vault: services.vault,
            },
        },
        discardSnapshotOnReset
    );
    const register = () => {
        services.databaseEvents.onBeforeDatabaseRecovery.addHandler(async () => {
            await resultProcessor.pauseForDatabaseRecovery();
            return true;
        });
        services.databaseEvents.onAfterDatabaseRecovery.addHandler(() => {
            // A readable connection also completes recovery after a transaction-only failure.
            // Resuming this hold is idempotent and preserves explicit user suspension.
            resultProcessor.resumeAfterDatabaseRecovery();
            if (recoveryEnabled) {
                // A retry may await a file lock still held by the recovery producer.
                fireAndForget(async () => {
                    try {
                        await resultProcessor.retryWaitingReflections("local-database");
                    } catch (error) {
                        createInstanceLogFunction("SF:ReflectionRecovery", services.API)(error, LOG_LEVEL_VERBOSE);
                    }
                });
            }
            return Promise.resolve(true);
        });
        if (discardSnapshotOnReset || recoveryEnabled) {
            services.database.onDatabaseReset.addHandler(async () => {
                await resultProcessor.completeStartupDatabaseReset();
                return true;
            });
        }
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
            rebuilder: core.rebuilder,
            services: {
                appLifecycle: services.appLifecycle,
                replicator: services.replicator,
                setting: services.setting,
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
        // Commonlib emits this each time it establishes readiness. Documents held until then, such as those restored
        // from the snapshot or received during a fetch, continue from here.
        services.context.events.onEvent(EVENT_APPLICATION_READY, () => resultProcessor.continueHeldDocuments());
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
        if (recoveryEnabled) {
            const stopObservingReflections = services.context.events.onEvent("event-file-changed", ({ file }) => {
                if (!resultProcessor.hasPendingReflections) {
                    return;
                }
                fireAndForget(async () => {
                    try {
                        const documentId = await services.path.path2id(file);
                        await resultProcessor.reconcilePendingDocument(documentId);
                    } catch (error) {
                        createInstanceLogFunction("SF:ReflectionRecovery", services.API)(error, LOG_LEVEL_VERBOSE);
                    }
                });
            });
            services.replication.onFileReflectionFailed.addHandler(async (target, error) => {
                await resultProcessor.registerReflectionFailure(target, error, "scan");
                return true;
            });
            services.replication.onFiniteReplicationCompleted.addHandler(() => {
                // Recovery inspection can await a file lock whose Chunk read still
                // observes this producer. Let its finite activity release first.
                fireAndForget(async () => {
                    try {
                        await resultProcessor.retryWaitingReflections();
                    } catch (error) {
                        createInstanceLogFunction("SF:ReflectionRecovery", services.API)(error, LOG_LEVEL_VERBOSE);
                    }
                });
                return Promise.resolve(true);
            });
            services.appLifecycle.onBeforeUnload.addHandler(async () => {
                stopObservingReflections();
                await resultProcessor.stop();
                return true;
            });
        }
    };
    return { recovery: resultProcessor.recovery, register };
}

/** Compose directly when the host does not need the recovery view during its earlier UI composition. */
export function useReplicationFeature<TContext extends ServiceContext, TCommands extends IMinimumLiveSyncCommands>(
    core: LiveSyncBaseCore<TContext, TCommands>
): ReflectionRecoveryView {
    const feature = createReplicationFeature(core);
    feature.register();
    return feature.recovery;
}
