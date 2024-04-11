import { deleteDB, type IDBPDatabase, openDB } from "idb";
export interface KeyValueDatabase {
    get<T>(key: string): Promise<T>;
    set<T>(key: string, value: T): Promise<IDBValidKey>;
    del(key: string): Promise<void>;
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
        get<T>(key: string): Promise<T> {
            return db.get(storeKey, key);
        },
        set<T>(key: string, value: T) {
            return db.put(storeKey, value, key);
        },
        del(key: string) {
            return db.delete(storeKey, key);
        },
        clear() {
            return db.clear(storeKey);
        },
        keys(query?: IDBValidKey | IDBKeyRange, count?: number) {
            return db.getAllKeys(storeKey, query, count);
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
