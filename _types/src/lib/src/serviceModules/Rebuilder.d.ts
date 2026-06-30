// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { IFileHandler } from "@lib/interfaces/FileHandler";
import type { APIService } from "@lib/services/base/APIService";
import type { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { DatabaseEventService } from "@lib/services/base/DatabaseEventService";
import type { DatabaseService } from "@lib/services/base/DatabaseService";
import type { RemoteService } from "@lib/services/base/RemoteService";
import type { ReplicationService } from "@lib/services/base/ReplicationService";
import type { ReplicatorService } from "@lib/services/base/ReplicatorService";
import type { SettingService } from "@lib/services/base/SettingService";
import type { VaultService } from "@lib/services/base/VaultService";
import type { UIService } from "@lib/services/implements/base/UIService";
import type { Rebuilder } from "@lib/interfaces/DatabaseRebuilder";
import type { StorageAccess } from "@lib/interfaces/StorageAccess";
import { ServiceModuleBase } from "@lib/serviceModules/ServiceModuleBase";
import type { ControlService } from "@lib/services/base/ControlService";
export interface ServiceRebuilderDependencies {
    appLifecycle: AppLifecycleService;
    API: APIService;
    UI: UIService;
    setting: SettingService;
    remote: RemoteService;
    databaseEvents: DatabaseEventService;
    storageAccess: StorageAccess;
    replicator: ReplicatorService;
    vault: VaultService;
    replication: ReplicationService;
    database: DatabaseService;
    fileHandler: IFileHandler;
    control: ControlService;
}
export declare class ServiceRebuilder extends ServiceModuleBase<ServiceRebuilderDependencies> implements Rebuilder {
    private appLifecycle;
    private API;
    private UI;
    private setting;
    private remote;
    private databaseEvents;
    private storageAccess;
    private replicator;
    private vault;
    private replication;
    private database;
    private fileHandler;
    private control;
    constructor(services: ServiceRebuilderDependencies);
    $performRebuildDB(method: "localOnly" | "remoteOnly" | "rebuildBothByThisDevice" | "localOnlyWithChunks"): Promise<void>;
    informOptionalFeatures(): Promise<void>;
    askUsingOptionalFeature(opt: {
        enableFetch?: boolean;
        enableOverwrite?: boolean;
    }): Promise<void>;
    rebuildRemote(): Promise<void>;
    $rebuildRemote(): Promise<void>;
    rebuildEverything(): Promise<void>;
    $rebuildEverything(): Promise<void>;
    $fetchLocal(makeLocalChunkBeforeSync?: boolean, preventMakeLocalFilesBeforeSync?: boolean): Promise<void>;
    $fetchLocalDBFast(autoResume: boolean): Promise<void>;
    scheduleRebuild(): Promise<void>;
    scheduleFetch(): Promise<void>;
    private _tryResetRemoteDatabase;
    private _onResetLocalDatabase;
    suspendAllSync(): Promise<void>;
    suspendReflectingDatabase(ignoreMinIO?: boolean): Promise<void>;
    resumeReflectingDatabase(ignoreMinIO?: boolean): Promise<void>;
    fetchLocal(makeLocalChunkBeforeSync?: boolean, preventMakeLocalFilesBeforeSync?: boolean, autoResume?: boolean): Promise<void>;
    fetchLocalDBFast(autoResume: boolean): Promise<void>;
    /**
     * Finish rebuild process with resuming the reflection.
     *
     * @param ignoreMinIO Whether to ignore minio for resuming the reflection.
     */
    finishRebuild(ignoreMinIO?: boolean): Promise<void>;
    /**
     * Fetch local database with making all chunks.
     * This is a wrapper for {@link fetchLocal} with makeLocalChunkBeforeSync = true.
     *
     * @returns
     */
    fetchLocalWithRebuild(): Promise<void>;
    private _allSuspendAllSync;
    resetLocalDatabase(): Promise<void>;
    private getFastFetchCheckpoint;
    private saveFastFetchCheckpoint;
    private clearFastFetchCheckpoint;
}
