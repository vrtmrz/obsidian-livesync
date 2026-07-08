// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type LOG_LEVEL } from "@lib/common/types";
import type { IAPIService, IDatabaseService, IFileProcessingService, IReplicationService, IReplicatorService, ISettingService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import { type LogFunction } from "@lib/services/lib/logUtils";
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import type { AppLifecycleService } from "./AppLifecycleService";
export interface ReplicationServiceDependencies {
    APIService: IAPIService;
    settingService: ISettingService;
    appLifecycleService: AppLifecycleService;
    databaseService: IDatabaseService;
    replicatorService: IReplicatorService;
    fileProcessingService: IFileProcessingService;
}
/**
 * The ReplicationService provides methods for managing replication processes.
 */
export declare abstract class ReplicationService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IReplicationService {
    private _unresolvedErrorManager;
    showError(msg: string, max_log_level?: LOG_LEVEL): void;
    clearErrors(): void;
    _log: LogFunction;
    settingService: ISettingService;
    appLifecycleService: AppLifecycleService;
    replicatorService: IReplicatorService;
    APIService: IAPIService;
    fileProcessing: IFileProcessingService;
    databaseService: IDatabaseService;
    constructor(context: T, dependencies: ReplicationServiceDependencies);
    /**
     * Process a synchronisation result document.
     */
    readonly processSynchroniseResult: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(doc: import("@lib/common/types").MetaEntry) => Promise<boolean>>;
    /**
     * Process a synchronisation result document for optional entries i.e., hidden files.
     */
    readonly processOptionalSynchroniseResult: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(doc: import("@lib/common/types").LoadedEntry) => Promise<boolean>>;
    /**
     * Process an array of synchronisation result documents.
     * @param docs An array of documents to parse and handle.
     */
    readonly parseSynchroniseResult: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(docs: Array<PouchDB.Core.ExistingDocument<import("@lib/common/types").EntryDoc>>) => Promise<boolean>>;
    /**
     * Process a virtual document (e.g., for customisation sync).
     */
    readonly processVirtualDocument: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(docs: PouchDB.Core.ExistingDocument<import("@lib/common/types").EntryDoc>) => Promise<boolean>>;
    /**
     * An event triggered before starting replication.
     */
    readonly onBeforeReplicate: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(showMessage: boolean) => Promise<boolean>>;
    /**
     *
     */
    readonly onCheckReplicationReady: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(showMessage: boolean) => Promise<boolean>>;
    /**
     *  Check if the replication is ready to start.
     * @param showMessage Whether to show messages to the user.
     */
    isReplicationReady(showMessage?: boolean): Promise<boolean>;
    onReplicationFailed: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(showMessage?: boolean) => Promise<boolean>>;
    /**
     * perform replication. The actual replication logic should be implemented in the handler of this event.
     * @param showMessage
     */
    performReplication(showMessage?: boolean): Promise<boolean | void>;
    /**
     * Start the replication process.
     * @param showMessage Whether to show messages to the user.
     */
    replicate(showMessage?: boolean): Promise<boolean | void>;
    previousReplicated: number;
    /**
     * Start the replication process triggered by an event (e.g., file change).
     * @param showMessage Whether to show messages to the user.
     */
    replicateByEvent(showMessage?: boolean): Promise<boolean | void>;
    /**
     * Check if there is a connection failure with the remote database.
     */
    readonly checkConnectionFailure: import("@lib/services/lib/HandlerUtils").MultipleHandlerFunction<() => Promise<boolean | "CHECKAGAIN" | undefined>, unknown>;
    databaseQueueCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    storageApplyingCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    replicationResultCount: import("octagonal-wheels/dataobject/reactive_v2").ReactiveSource<number>;
    getActiveReplicatorFor(usage: string): false | LiveSyncAbstractReplicator;
    replicateAllToRemote(showingNotice?: boolean, sendChunksInBulkDisabled?: boolean): Promise<boolean>;
    replicateAllFromRemote(showingNotice?: boolean): Promise<boolean>;
    private _getReplicatorAndPerform;
    markLocked(lockByClean?: boolean): Promise<void>;
    markUnlocked(): Promise<void>;
    markResolved(): Promise<void>;
}
