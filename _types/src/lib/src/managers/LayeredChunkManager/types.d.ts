// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: bbf2539
import type { EntryDoc } from "@lib/common/models/db.definition";
import type { DocumentID, EntryLeaf } from "@lib/common/models/db.type";
import type { ISettingService } from "@lib/services/base/IService";
import type { ChangeManager } from "@lib/managers/ChangeManager";
import type { EVENT_CHUNK_FETCHED, EVENT_MISSING_CHUNK_REMOTE, EVENT_MISSING_CHUNKS } from "@lib/managers/ChunkFetcher";
import type { ActivityCountSource } from "@lib/managers/ChunkDeliveryCoordinator";
export type ChunkManagerOptions = {
    database: PouchDB.Database<EntryDoc>;
    changeManager: ChangeManager<EntryDoc>;
    settingService: ISettingService;
    /** Finite replication which may still deliver a requested chunk. */
    finiteReplicationActivity?: ActivityCountSource;
};
export type ChunkReadOptions = {
    skipCache?: boolean;
    /** Wait for an already-observable finite delivery lifecycle. */
    waitForDelivery?: boolean;
    /** @deprecated Use `waitForDelivery`. Positive values no longer represent an arrival duration. */
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
