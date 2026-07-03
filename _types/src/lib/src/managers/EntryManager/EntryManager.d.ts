// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type FilePathWithPrefix, type FilePath, type LoadedEntry, type EntryDoc, type SavingEntry, type MetaEntry } from "@lib/common/types";
import type { ChunkManager } from "@lib/managers/ChunkManager";
import type { ContentSplitter } from "@lib/ContentSplitter/ContentSplitters";
import type { HashManager } from "@lib/managers/HashManager/HashManager";
import type { GeneratedChunk } from "@lib/pouchdb/LiveSyncLocalDB";
import type { IPathService, ISettingService } from "@lib/services/base/IService";
export interface EntryManagerOptions {
    hashManager: HashManager;
    chunkManager: ChunkManager;
    splitter: ContentSplitter;
    database: PouchDB.Database<EntryDoc>;
    settingService: ISettingService;
    pathService: IPathService;
}
export declare class EntryManager {
    options: EntryManagerOptions;
    constructor(options: EntryManagerOptions);
    get localDatabase(): PouchDB.Database<EntryDoc>;
    get hashManager(): HashManager;
    get chunkManager(): ChunkManager;
    get splitter(): ContentSplitter;
    get serviceHost(): {
        services: {
            setting: ISettingService;
            path: IPathService;
        };
        serviceModules: {}; // eslint-disable-line @typescript-eslint/no-empty-object-type, @typescript-eslint/ban-types -- Empty object type
    };
    get isOnDemandChunkEnabled(): boolean;
    isTargetFile(filenameSrc: string): boolean;
    prepareChunk(piece: string): Promise<GeneratedChunk>;
    getDBEntryMeta(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions, includeDeleted?: boolean): Promise<false | LoadedEntry>;
    getDBEntry(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions, dump?: boolean, waitForReady?: boolean, includeDeleted?: boolean): Promise<false | LoadedEntry>;
    getDBEntryFromMeta(meta: LoadedEntry | MetaEntry, dump?: boolean, waitForReady?: boolean): Promise<false | LoadedEntry>;
    deleteDBEntry(path: FilePathWithPrefix | FilePath, opt?: PouchDB.Core.GetOptions): Promise<boolean>;
    putDBEntry(note: SavingEntry, onlyChunks?: boolean, conflictBaseRev?: string): Promise<false | PouchDB.Core.Response>;
}
