import { deleteDB, type IDBPDatabase, openDB } from "idb";
export interface KeyValueDatabase {
    get<T>(key: IDBValidKey): Promise<T>;
    set<T>(key: IDBValidKey, value: T): Promise<IDBValidKey>;
    del(key: IDBValidKey): Promise<void>;
    clear(): Promise<void>;
    keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]>;
    close(): void;
    destroy(): Promise<void>;
}
const databaseCache: { [key: string]: IDBPDatabase<any> } = {};
export const OpenKeyValueDatabase = async (dbKey: string): Promise<KeyValueDatabase> => {
    if (dbKey in databaseCache) {
        databaseCache[dbKey].close();
        delete databaseCache[dbKey];
    }
    const storeKey = dbKey;
    const dbPromise = openDB(dbKey, 1, {
        upgrade(db) {
            db.createObjectStore(storeKey);
        },
    });
    const db = await dbPromise;
    databaseCache[dbKey] = db;
    return {
        async get<T>(key: IDBValidKey): Promise<T> {
            return await db.get(storeKey, key);
        },
        async set<T>(key: IDBValidKey, value: T) {
            return await db.put(storeKey, value, key);
        },
        async del(key: IDBValidKey) {
            return await db.delete(storeKey, key);
        },
        async clear() {
            return await db.clear(storeKey);
        },
        async keys(query?: IDBValidKey | IDBKeyRange, count?: number) {
            return await db.getAllKeys(storeKey, query, count);
        },
        close() {
            delete databaseCache[dbKey];
            return db.close();
        },
        async destroy() {
            delete databaseCache[dbKey];
            db.close();
            await deleteDB(dbKey);
        },
    };
};
