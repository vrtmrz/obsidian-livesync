// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type EntryDoc } from "@lib/common/types";
import { ContentSplitter } from "@lib/ContentSplitter/ContentSplitters.ts";
import { ChangeManager } from "@lib/managers/ChangeManager.ts";
import { ChunkFetcher } from "@lib/managers/ChunkFetcher.ts";
import { ChunkManager } from "@lib/managers/ChunkManager.ts";
import { ConflictManager } from "@lib/managers/ConflictManager.ts";
import { EntryManager } from "@lib/managers/EntryManager/EntryManager.ts";
import { HashManager } from "@lib/managers/HashManager/HashManager.ts";
import type { APIService } from "@lib/services/base/APIService.ts";
import type { IDatabaseService, IPathService, IReplicatorService, ISettingService } from "@lib/services/base/IService.ts";
import { type LogFunction } from "@lib/services/lib/logUtils.ts";
export interface LiveSyncManagersOptions<TSettingService extends ISettingService = ISettingService> {
    database: PouchDB.Database<EntryDoc>;
    databaseService: IDatabaseService;
    settingService: TSettingService;
    pathService: IPathService;
    replicatorService: IReplicatorService;
    APIService: APIService;
}
export declare class LiveSyncManagers {
    protected _pathService: IPathService;
    protected _replicatorService: IReplicatorService;
    protected _settingService: ISettingService;
    protected _APIService: APIService;
    hashManager: HashManager;
    chunkFetcher: ChunkFetcher;
    changeManager: ChangeManager<EntryDoc>;
    chunkManager: ChunkManager;
    splitter: ContentSplitter;
    entryManager: EntryManager;
    conflictManager: ConflictManager;
    protected options: LiveSyncManagersOptions;
    protected log: LogFunction;
    constructor(options: LiveSyncManagersOptions);
    teardownManagers(): Promise<void>;
    protected getManagerMembers(): {
        changeManager: ChangeManager<EntryDoc>;
        hashManager: HashManager;
        splitter: ContentSplitter;
        chunkManager: ChunkManager;
        chunkFetcher: ChunkFetcher;
        entryManager: EntryManager;
        conflictManager: ConflictManager;
    };
    initialise(): Promise<void>;
    reinitialise(): Promise<void>;
    clearCaches(): void;
    prepareHashFunction(): Promise<void>;
}
