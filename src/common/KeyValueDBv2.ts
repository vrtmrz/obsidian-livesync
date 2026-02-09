import { LOG_LEVEL_VERBOSE, Logger } from "@/lib/src/common/logger";
import type { KeyValueDatabase } from "@/lib/src/interfaces/KeyValueDatabase";
import { deleteDB, openDB, type IDBPDatabase } from "idb";
import { serialized } from "octagonal-wheels/concurrency/lock";

const databaseCache = new Map<string, IDBKeyValueDatabase>();

export async function OpenKeyValueDatabase(dbKey: string): Promise<KeyValueDatabase> {
    return await serialized(`OpenKeyValueDatabase-${dbKey}`, async () => {
        const cachedDB = databaseCache.get(dbKey);
        if (cachedDB) {
            if (!cachedDB.isDestroyed) {
                return cachedDB;
            }
            await cachedDB.ensuredDestroyed;
            databaseCache.delete(dbKey);
        }
        const newDB = new IDBKeyValueDatabase(dbKey);
        try {
            await newDB.getIsReady();
            databaseCache.set(dbKey, newDB);
            return newDB;
        } catch (e) {
            databaseCache.delete(dbKey);
            throw e;
        }
    });
}

export class IDBKeyValueDatabase implements KeyValueDatabase {
    protected _dbPromise: Promise<IDBPDatabase<any>> | null = null;
    protected dbKey: string;
    protected storeKey: string;
    protected _isDestroyed: boolean = false;
    protected destroyedPromise: Promise<void> | null = null;

    get isDestroyed() {
        return this._isDestroyed;
    }
    get ensuredDestroyed(): Promise<void> {
        if (this.destroyedPromise) {
            return this.destroyedPromise;
        }
        return Promise.resolve();
    }

    async getIsReady(): Promise<boolean> {
        await this.ensureDB();
        return this.isDestroyed === false;
    }

    protected ensureDB() {
        if (this._isDestroyed) {
            throw new Error("Database is destroyed");
        }
        if (this._dbPromise) {
            return this._dbPromise;
        }
        this._dbPromise = openDB(this.dbKey, undefined, {
            upgrade: (db, _oldVersion, _newVersion, _transaction, _event) => {
                if (!db.objectStoreNames.contains(this.storeKey)) {
                    return db.createObjectStore(this.storeKey);
                }
            },
            blocking: (currentVersion, blockedVersion, event) => {
                Logger(
                    `Blocking database open for ${this.dbKey}: currentVersion=${currentVersion}, blockedVersion=${blockedVersion}`,
                    LOG_LEVEL_VERBOSE
                );
                // This `this` is not this openDB instance, previously opened DB. Let it be closed in the terminated handler.
                void this.closeDB(true);
            },
            blocked: (currentVersion, blockedVersion, event) => {
                Logger(
                    `Database open blocked for ${this.dbKey}: currentVersion=${currentVersion}, blockedVersion=${blockedVersion}`,
                    LOG_LEVEL_VERBOSE
                );
            },
            terminated: () => {
                Logger(`Database connection terminated for ${this.dbKey}`, LOG_LEVEL_VERBOSE);
                this._dbPromise = null;
            },
        }).catch((e) => {
            this._dbPromise = null;
            throw e;
        });
        return this._dbPromise;
    }
    protected async closeDB(setDestroyed: boolean = false) {
        if (this._dbPromise) {
            const tempPromise = this._dbPromise;
            this._dbPromise = null;
            try {
                const dbR = await tempPromise;
                dbR.close();
            } catch (e) {
                Logger(`Error closing database`);
                Logger(e, LOG_LEVEL_VERBOSE);
            }
        }
        this._dbPromise = null;
        if (setDestroyed) {
            this._isDestroyed = true;
            this.destroyedPromise = Promise.resolve();
        }
    }
    get DB(): Promise<IDBPDatabase<any>> {
        if (this._isDestroyed) {
            return Promise.reject(new Error("Database is destroyed"));
        }
        return this.ensureDB();
    }

    constructor(dbKey: string) {
        this.dbKey = dbKey;
        this.storeKey = dbKey;
    }
    async get<U>(key: IDBValidKey): Promise<U> {
        const db = await this.DB;
        return await db.get(this.storeKey, key);
    }
    async set<U>(key: IDBValidKey, value: U): Promise<IDBValidKey> {
        const db = await this.DB;
        await db.put(this.storeKey, value, key);
        return key;
    }
    async del(key: IDBValidKey): Promise<void> {
        const db = await this.DB;
        return await db.delete(this.storeKey, key);
    }
    async clear(): Promise<void> {
        const db = await this.DB;
        return await db.clear(this.storeKey);
    }
    async keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]> {
        const db = await this.DB;
        return await db.getAllKeys(this.storeKey, query, count);
    }
    async close(): Promise<void> {
        await this.closeDB();
    }
    async destroy(): Promise<void> {
        this._isDestroyed = true;
        this.destroyedPromise = (async () => {
            await this.closeDB();
            await deleteDB(this.dbKey, {
                blocked: () => {
                    Logger(`Database delete blocked for ${this.dbKey}`);
                },
            });
        })();
        await this.destroyedPromise;
    }
}
