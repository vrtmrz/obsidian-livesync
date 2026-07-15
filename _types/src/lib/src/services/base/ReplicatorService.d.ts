// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: a58965f
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import type { IReplicatorService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import type { SettingService } from "./SettingService";
import type { AppLifecycleService } from "./AppLifecycleService";
import { UnresolvedErrorManager } from "./UnresolvedErrorManager";
import type { DatabaseEventService } from "./DatabaseEventService";
import { type AsyncActivityOptions, type AsyncActivityRunner } from "@lib/interfaces/AsyncActivityRunner.ts";
export interface ReplicatorServiceDependencies {
    settingService: SettingService;
    appLifecycleService: AppLifecycleService;
    databaseEventService: DatabaseEventService;
    activityRunner?: AsyncActivityRunner;
}
/**
 * The ReplicatorService provides methods for managing replication.
 */
export declare abstract class ReplicatorService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IReplicatorService {
    protected dependencies: ReplicatorServiceDependencies;
    readonly boundedRemoteActivityCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    _log: (msg: unknown, level?: import("octagonal-wheels/common/logger").LOG_LEVEL, key?: string) => void;
    private settingService;
    private databaseEventService;
    private _activeReplicator;
    private _replicatorType;
    private appLifecycleService;
    _unresolvedErrorManager: UnresolvedErrorManager;
    constructor(context: T, dependencies: ReplicatorServiceDependencies);
    /**
     * Runs one finite remote operation while exposing its lifetime to host policy and status UI.
     * Continuous replication must not use this boundary.
     */
    runBoundedRemoteActivity<TValue>(task: () => TValue | PromiseLike<TValue>, options?: AsyncActivityOptions): Promise<TValue>;
    private suspendReplication;
    private reinitialiseReplicator;
    private disposeReplicator;
    private _initialiseReplicator;
    /**
     * Close the active replication if any.
     * Not used currently.
     */
    readonly onCloseActiveReplication: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Get a new replicator instance based on the provided settings.
     */
    readonly getNewReplicator: import("@lib/services/lib/HandlerUtils").MultipleHandlerFunction<(settingOverride?: Partial<import("@lib/common/types").ObsidianLiveSyncSettings>) => Promise<LiveSyncAbstractReplicator | undefined | false>, unknown>;
    readonly onReplicatorInitialised: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    /**
     * Get the currently active replicator instance.
     * If no active replicator, return undefined but that is the fatal situation (on Obsidian).
     */
    getActiveReplicator(): LiveSyncAbstractReplicator | undefined;
    replicationStatics: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<{
        sent: number;
        arrived: number;
        maxPullSeq: number;
        maxPushSeq: number;
        lastSyncPullSeq: number;
        lastSyncPushSeq: number;
        syncStatus: import("@lib/common/types").DatabaseConnectingStatus;
    }>;
}
