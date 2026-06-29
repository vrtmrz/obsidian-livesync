// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { EntryDoc } from "@lib/common/models/db.definition";
import type { DocumentID, EntryLeaf } from "@lib/common/models/db.type";
import type { ISettingService } from "@lib/services/base/IService";
import type { ChangeManager } from "@lib/managers/ChangeManager";
import type { EVENT_CHUNK_FETCHED, EVENT_MISSING_CHUNK_REMOTE, EVENT_MISSING_CHUNKS } from "@lib/managers/ChunkFetcher";
export type ChunkManagerOptions = {
    database: PouchDB.Database<EntryDoc>;
    changeManager: ChangeManager<EntryDoc>;
    settingService: ISettingService;
};
export type ChunkReadOptions = {
    skipCache?: boolean;
    timeout?: number;
    preventRemoteRequest?: boolean;
};
export type ChunkWriteOptions = {
    skipCache?: boolean;
    force?: boolean;
};
export type WriteResult = {
    result: boolean;
    processed: {
        cached: number;
        hotPack: number;
        written: number;
        duplicated: number;
    };
};
export type ChunkManagerEventMap = {
    [EVENT_MISSING_CHUNK_REMOTE]: DocumentID;
    [EVENT_MISSING_CHUNKS]: DocumentID[];
    [EVENT_CHUNK_FETCHED]: EntryLeaf;
};
