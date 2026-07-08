// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { CouchDBConnection } from "@lib/common/types";
export declare function purgeUnreferencedChunks(db: PouchDB.Database, dryRun: boolean, connSetting?: CouchDBConnection, performCompact?: boolean): Promise<number>;
export declare function transferChunks(key: string, label: string, dbFrom: PouchDB.Database, dbTo: PouchDB.Database, items: {
    id: string;
    rev: string;
}[]): Promise<boolean>;
export declare function balanceChunkPurgedDBs(local: PouchDB.Database, remote: PouchDB.Database): Promise<void>;
export declare function fetchAllUsedChunks(local: PouchDB.Database, remote: PouchDB.Database): Promise<void>;
export declare function purgeChunksLocal(db: PouchDB.Database, docs: {
    id: string;
    rev: string;
}[]): Promise<void>;
export declare function collectUnbalancedChunkIDs(local: PouchDB.Database, remote: PouchDB.Database): Promise<{
    onlyOnLocal: {
        id: string;
        rev: string;
    }[];
    onlyOnRemote: {
        id: string;
        rev: string;
    }[];
}>;
export declare function collectChunks(db: PouchDB.Database, type: "INUSE" | "DANGLING" | "ALL"): Promise<{
    id: string;
    rev: string;
}[]>;
export declare function collectChunksUsage(db: PouchDB.Database): Promise<{
    value: number;
    key: string[];
}[]>;
export declare function collectUnreferencedChunks(db: PouchDB.Database): Promise<{
    id: string;
    rev: string;
}[]>;
export declare function purgeChunksRemote(setting: CouchDBConnection, docs: {
    id: string;
    rev: string;
}[]): Promise<void>;
