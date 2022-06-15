import { deleteDB, IDBPDatabase, openDB } from "idb";
export interface KeyValueDatabase {
    get<T>(key: string): Promise<T>;
    set<T>(key: string, value: T): Promise<IDBValidKey>;
    del(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]>;
    close(): void;
    destroy(): void;
}
const databaseCache: { [key: string]: IDBPDatabase<any> } = {};
export const OpenKeyValueDatabase = (dbKey: string): KeyValueDatabase => {
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
    ~(async () => (databaseCache[dbKey] = await dbPromise))();
    return {
        async get<T>(key: string): Promise<T> {
            return (await dbPromise).get(storeKey, key);
        },
        async set<T>(key: string, value: T) {
            return (await dbPromise).put(storeKey, value, key);
        },
        async del(key: string) {
            return (await dbPromise).delete(storeKey, key);
        },
        async clear() {
            return (await dbPromise).clear(storeKey);
        },
        async keys(query?: IDBValidKey | IDBKeyRange, count?: number) {
            return (await dbPromise).getAllKeys(storeKey, query, count);
        },
        async close() {
            delete databaseCache[dbKey];
            return (await dbPromise).close();
        },
        async destroy() {
            delete databaseCache[dbKey];
            (await dbPromise).close();
            await deleteDB(dbKey);
        },
    };
};
