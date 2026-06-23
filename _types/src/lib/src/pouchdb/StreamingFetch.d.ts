// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: bc1806f
import type { EntryDoc } from "@lib/common/models/db.definition";
import type { AnyEntry, EntryLeaf } from "@lib/common/models/db.type";
export type FetchChangesForInitialSyncProgress = {
    totalFetched: number;
    totalValidFetched: number;
    targetSeq: number | string;
    docsToFetch: number;
    totalBytes: number;
};
/**
 * Fetches initial data from CouchDB as a stream and writes it into PouchDB.
 * @param downloadToDB PouchDB instance.
 * @param remoteDbUrl CouchDB database URL (for example: 'https://xxx.com/mydb').
 * @param decryptFunction Function to decrypt each document.
 * @param since Sequence ID to start fetching changes from (default is '0').
 */
export declare function fetchChangesForInitialSync(downloadToDB: PouchDB.Database, remoteDbUrl: string, authHeader: string, decryptFunction: (doc: EntryDoc) => Promise<AnyEntry | EntryLeaf>, since?: number | string, onProgress?: (progress: FetchChangesForInitialSyncProgress) => void): Promise<void>;
