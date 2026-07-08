// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { KeyValueDatabase } from "@lib/interfaces/KeyValueDatabase";
import { type IDBPDatabase } from "idb";
export declare function OpenKeyValueDatabase(dbKey: string): Promise<KeyValueDatabase>;
export declare class IDBKeyValueDatabase implements KeyValueDatabase {
    protected _dbPromise: Promise<IDBPDatabase<unknown>> | null;
    protected dbKey: string;
    protected storeKey: string;
    protected _isDestroyed: boolean;
    protected destroyedPromise: Promise<void> | null;
    get isDestroyed(): boolean;
    get ensuredDestroyed(): Promise<void>;
    getIsReady(): Promise<boolean>;
    protected ensureDB(): Promise<IDBPDatabase<unknown>>;
    protected closeDB(setDestroyed?: boolean): Promise<void>;
    get DB(): Promise<IDBPDatabase<unknown>>;
    constructor(dbKey: string);
    get<U>(key: IDBValidKey): Promise<U>;
    set<U>(key: IDBValidKey, value: U): Promise<IDBValidKey>;
    del(key: IDBValidKey): Promise<void>;
    clear(): Promise<void>;
    keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]>;
    close(): Promise<void>;
    destroy(): Promise<void>;
}
