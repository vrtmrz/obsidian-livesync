import type { EntryDoc } from "@lib/common/models/db.definition";
import { ContentSplitter } from "@lib/ContentSplitter/ContentSplitters.ts";
import { ChangeManager } from "./ChangeManager.ts";
import { ChunkFetcher } from "./ChunkFetcher.ts";
import { ChunkManager } from "./ChunkManager.ts";
import { ConflictManager } from "./ConflictManager.ts";
import { EntryManager } from "./EntryManager/EntryManager.ts";
import { HashManager } from "./HashManager/HashManager.ts";
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
