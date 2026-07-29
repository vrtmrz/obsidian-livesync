import type {
    KeyValueDatabase,
    KeyValueDatabaseFactory,
} from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import { deleteDB, openDB, type IDBPDatabase } from "idb";
import { serialized } from "octagonal-wheels/concurrency/lock";

/** Creates an application-owned IndexedDB key-value factory for browser runtimes. */
export function createBrowserKeyValueDatabaseFactory(): KeyValueDatabaseFactory {
    const cache = new Map<string, BrowserKeyValueDatabase>();

    return async (databaseKey) =>
        await serialized(`OpenBrowserKeyValueDatabase-${databaseKey}`, async () => {
            const cached = cache.get(databaseKey);
            if (cached && !cached.isDestroyed) {
                return cached;
            }
            if (cached) {
                await cached.ensuredDestroyed;
                cache.delete(databaseKey);
            }

            const database = new BrowserKeyValueDatabase(databaseKey);
            await database.getIsReady();
            cache.set(databaseKey, database);
            return database;
        });
}

class BrowserKeyValueDatabase implements KeyValueDatabase {
    private databasePromise?: Promise<IDBPDatabase<unknown>>;
    private destroyed = false;
    private destroyedPromise?: Promise<void>;

    constructor(private readonly databaseKey: string) {}

    get isDestroyed(): boolean {
        return this.destroyed;
    }

    get ensuredDestroyed(): Promise<void> {
        return this.destroyedPromise ?? Promise.resolve();
    }

    async getIsReady(): Promise<boolean> {
        await this.ensureDatabase();
        return !this.destroyed;
    }

    private ensureDatabase(): Promise<IDBPDatabase<unknown>> {
        if (this.destroyed) {
            throw new Error("Database is destroyed");
        }
        this.databasePromise ??= openDB(this.databaseKey, undefined, {
            upgrade: (database) => {
                if (!database.objectStoreNames.contains(this.databaseKey)) {
                    database.createObjectStore(this.databaseKey);
                }
            },
            blocking: () => {
                void this.closeDatabase();
            },
            terminated: () => {
                this.databasePromise = undefined;
            },
        }).catch((error: unknown) => {
            this.databasePromise = undefined;
            throw error;
        });
        return this.databasePromise;
    }

    private get database(): Promise<IDBPDatabase<unknown>> {
        return this.ensureDatabase();
    }

    private async closeDatabase(): Promise<void> {
        const databasePromise = this.databasePromise;
        this.databasePromise = undefined;
        if (databasePromise) {
            (await databasePromise).close();
        }
    }

    async get<T>(key: IDBValidKey): Promise<T> {
        return (await (await this.database).get(this.databaseKey, key)) as T;
    }

    async set<T>(key: IDBValidKey, value: T): Promise<IDBValidKey> {
        await (await this.database).put(this.databaseKey, value, key);
        return key;
    }

    async del(key: IDBValidKey): Promise<void> {
        await (await this.database).delete(this.databaseKey, key);
    }

    async clear(): Promise<void> {
        await (await this.database).clear(this.databaseKey);
    }

    async keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]> {
        return await (await this.database).getAllKeys(this.databaseKey, query, count);
    }

    async close(): Promise<void> {
        await this.closeDatabase();
    }

    async destroy(): Promise<void> {
        if (this.destroyedPromise) {
            await this.destroyedPromise;
            return;
        }
        this.destroyed = true;
        this.destroyedPromise = (async () => {
            await this.closeDatabase();
            await deleteDB(this.databaseKey);
        })();
        await this.destroyedPromise;
    }
}
