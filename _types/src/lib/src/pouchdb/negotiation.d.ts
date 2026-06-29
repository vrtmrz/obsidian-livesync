// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare const checkRemoteVersion: (db: PouchDB.Database, migrate: (from: number, to: number) => Promise<boolean>, barrier?: number) => Promise<boolean>;
export declare const bumpRemoteVersion: (db: PouchDB.Database, barrier?: number) => Promise<boolean>;
export declare const checkSyncInfo: (db: PouchDB.Database) => Promise<boolean>;
/**
 * Counts the number of remote (potentially) compromised chunks in the database.
 * @param db The PouchDB database instance.
 * @returns The number of compromised chunks or false if an error occurs.
 */
export declare function countCompromisedChunks(db: PouchDB.Database): Promise<number | false>;
