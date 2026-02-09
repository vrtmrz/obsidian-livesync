import { deleteDB, type IDBPDatabase, openDB } from "idb";
import type { KeyValueDatabase } from "../lib/src/interfaces/KeyValueDatabase.ts";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { Logger } from "octagonal-wheels/common/logger";
const databaseCache: { [key: string]: IDBPDatabase<any> } = {};
export { OpenKeyValueDatabase } from "./KeyValueDBv2.ts";

export const _OpenKeyValueDatabase = async (dbKey: string): Promise<KeyValueDatabase> => {
    if (dbKey in databaseCache) {
        databaseCache[dbKey].close();
        delete databaseCache[dbKey];
    }
    const storeKey = dbKey;
    let db: IDBPDatabase<any> | null = null;
    const _openDB = () => {
        return serialized("keyvaluedb-" + dbKey, async () => {
            const dbInstance = await openDB(dbKey, 1, {
                upgrade(db, _oldVersion, _newVersion, _transaction, _event) {
                    return db.createObjectStore(storeKey);
                },
                blocking(currentVersion, blockedVersion, event) {
                    Logger(
                        `Blocking database open for ${dbKey}: currentVersion=${currentVersion}, blockedVersion=${blockedVersion}`
                    );
                    databaseCache[dbKey]?.close();
                    delete databaseCache[dbKey];
                },
                blocked(currentVersion, blockedVersion, event) {
                    Logger(
                        `Database open blocked for ${dbKey}: currentVersion=${currentVersion}, blockedVersion=${blockedVersion}`
                    );
                },
                terminated() {
                    Logger(`Database connection terminated for ${dbKey}`);
                },
            });
            databaseCache[dbKey] = dbInstance;
            return dbInstance;
        });
    };
    const closeDB = () => {
        if (db) {
            db.close();
            delete databaseCache[dbKey];
            db = null;
        }
    };
    db = await _openDB();
    return {
        async get<T>(key: IDBValidKey): Promise<T> {
            if (!db) {
                db = await _openDB();
                databaseCache[dbKey] = db;
            }
            return await db.get(storeKey, key);
        },
        async set<T>(key: IDBValidKey, value: T) {
            if (!db) {
                db = await _openDB();
                databaseCache[dbKey] = db;
            }
            return await db.put(storeKey, value, key);
        },
        async del(key: IDBValidKey) {
            if (!db) {
                db = await _openDB();
                databaseCache[dbKey] = db;
            }
            return await db.delete(storeKey, key);
        },
        async clear() {
            if (!db) {
                db = await _openDB();
                databaseCache[dbKey] = db;
            }
            return await db.clear(storeKey);
        },
        async keys(query?: IDBValidKey | IDBKeyRange, count?: number) {
            if (!db) {
                db = await _openDB();
                databaseCache[dbKey] = db;
            }
            return await db.getAllKeys(storeKey, query, count);
        },
        close() {
            delete databaseCache[dbKey];
            return Promise.resolve(closeDB());
        },
        async destroy() {
            delete databaseCache[dbKey];
            // await closeDB();
            await deleteDB(dbKey, {
                blocked() {
                    console.warn(`Database delete blocked for ${dbKey}`);
                },
            });
        },
    };
};
