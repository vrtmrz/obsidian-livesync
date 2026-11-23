import { LOG_LEVEL_VERBOSE, Logger } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import { compatGlobal } from "@vrtmrz/livesync-commonlib/compat/common/coreEnvFunctions";
import type { KeyValueDatabase } from "@vrtmrz/livesync-commonlib/compat/interfaces/KeyValueDatabase";
import { deleteDB, openDB, type IDBPDatabase } from "idb";
import { promiseWithResolvers } from "octagonal-wheels/promises";

export type KeyValueBatchOperation =
    | { type: "put"; key: IDBValidKey; value: unknown }
    | { type: "delete"; key: IDBValidKey };

export interface IncrementalKeyValueStore extends KeyValueDatabase {
    readonly connectionEpoch: number;
    applyBatch(
        operations: readonly KeyValueBatchOperation[],
        beforeTransaction?: () => void,
        signal?: AbortSignal
    ): Promise<void>;
    getEntries<U>(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<Array<{ key: IDBValidKey; value: U }>>;
}

function checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason ?? new Error("Operation aborted");
}

// Keep the handoff visible if Obsidian evaluates a new copy of the plug-in bundle.
const retirementKey = Symbol.for("self-hosted-livesync.obsidian.key-value-database-retirements");
const renderer: typeof compatGlobal & { [retirementKey]?: Map<string, Promise<void>> } = compatGlobal;
const retiringStores = (renderer[retirementKey] ??= new Map<string, Promise<void>>());

export async function OpenKeyValueDatabase(dbKey: string): Promise<IDBKeyValueDatabase> {
    while (retiringStores.has(dbKey)) {
        await retiringStores.get(dbKey);
    }
    const db = new IDBKeyValueDatabase(dbKey);
    await db.getIsReady();
    return db;
}

/** One plug-in instance's connections and its handoff to subsequent instances. */
export class KeyValueDatabaseOwner {
    private storeKey?: string;
    private store?: IDBKeyValueDatabase;
    private retirement?: Promise<void>;

    constructor(private readonly beforeStoreReplacement: () => Promise<void>) {}

    async open(dbKey: string): Promise<IDBKeyValueDatabase> {
        if (this.retirement) throw new Error("Key-value database owner is retiring");
        this.storeKey = dbKey;
        for (;;) {
            if (this.retirement) throw new Error("Key-value database owner is retiring");
            const retiring = retiringStores.get(dbKey);
            if (!retiring) break;
            await retiring;
        }
        const db = new IDBKeyValueDatabase(dbKey, async (destroying) => {
            if (this.store === db && (destroying || !this.retirement)) await this.beforeStoreReplacement();
        });
        this.store = db;
        await db.getIsReady();
        if (this.retirement) {
            await db.close();
            throw new Error("Key-value database owner is retiring");
        }
        return db;
    }

    retire(teardown: () => Promise<void>, fallbackDbKey?: string): Promise<void> {
        if (this.retirement) return this.retirement;
        const retirement = promiseWithResolvers<void>();
        this.retirement = retirement.promise;
        for (const key of new Set([this.storeKey, fallbackDbKey])) {
            if (key === undefined) continue;
            const prior = retiringStores.get(key);
            const handoff = Promise.allSettled(prior ? [prior, retirement.promise] : [retirement.promise]).then(() => {
                if (retiringStores.get(key) === handoff) retiringStores.delete(key);
            });
            retiringStores.set(key, handoff);
        }
        void (async () => {
            try {
                await teardown();
            } finally {
                await this.store?.close();
            }
        })().then(retirement.resolve, retirement.reject);
        return retirement.promise;
    }
}

export class IDBKeyValueDatabase implements IncrementalKeyValueStore {
    private connection?: Promise<IDBPDatabase<unknown>>;
    private closing?: Promise<void>;
    private destruction?: Promise<void>;
    private destroying = false;
    private closed = false;
    private epoch = 0;

    get connectionEpoch(): number {
        return this.epoch;
    }

    constructor(
        private readonly dbKey: string,
        private readonly beforeOwnedStoreClose?: (destroying: boolean) => Promise<void>
    ) {}

    async getIsReady(): Promise<boolean> {
        await this.DB;
        return !this.destroying;
    }

    get DB(): Promise<IDBPDatabase<unknown>> {
        if (this.closed || this.destroying) {
            return Promise.reject(new Error("Key-value database is closed"));
        }
        if (this.closing) return this.closing.then(() => this.DB);
        if (this.connection) return this.connection;

        const forgetConnection = () => {
            if (this.connection === opening) this.connection = undefined;
        };
        const invalidateConnection = (storeDeleted: boolean) => {
            if (this.connection !== opening) return;
            forgetConnection();
            ++this.epoch;
            if (storeDeleted) {
                void this.beforeOwnedStoreClose?.(false).catch((error: unknown) => Logger(error, LOG_LEVEL_VERBOSE));
            }
        };
        const opening = openDB(this.dbKey, undefined, {
            upgrade: (db) => {
                if (!db.objectStoreNames.contains(this.dbKey)) {
                    db.createObjectStore(this.dbKey);
                }
            },
            blocking: (currentVersion, blockedVersion, event) => {
                Logger(
                    `Blocking database open for ${this.dbKey}: currentVersion=${currentVersion}, blockedVersion=${blockedVersion}`,
                    LOG_LEVEL_VERBOSE
                );
                if (event.target instanceof IDBDatabase) event.target.close();
                invalidateConnection(blockedVersion === null);
            },
            blocked: (currentVersion, blockedVersion) => {
                Logger(
                    `Database open blocked for ${this.dbKey}: currentVersion=${currentVersion}, blockedVersion=${blockedVersion}`,
                    LOG_LEVEL_VERBOSE
                );
            },
            terminated: () => {
                Logger(`Database connection terminated for ${this.dbKey}`, LOG_LEVEL_VERBOSE);
                invalidateConnection(false);
            },
        }).catch((error) => {
            forgetConnection();
            throw error;
        });
        this.connection = opening;
        return opening;
    }

    async get<U>(key: IDBValidKey): Promise<U> {
        const db = await this.DB;
        return (await db.get(this.dbKey, key)) as U;
    }

    async set<U>(key: IDBValidKey, value: U): Promise<IDBValidKey> {
        await this.applyBatch([{ type: "put", key, value }]);
        return key;
    }

    async del(key: IDBValidKey): Promise<void> {
        await this.applyBatch([{ type: "delete", key }]);
    }

    async clear(): Promise<void> {
        const db = await this.DB;
        await db.clear(this.dbKey);
    }

    async keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]> {
        const db = await this.DB;
        return await db.getAllKeys(this.dbKey, query, count);
    }

    async applyBatch(
        operations: readonly KeyValueBatchOperation[],
        beforeTransaction?: () => void,
        signal?: AbortSignal
    ): Promise<void> {
        const db = await this.DB;
        beforeTransaction?.();
        checkAbort(signal);
        const tx = db.transaction(this.dbKey, "readwrite");
        const settled = tx.done.catch((): void => undefined);
        const abort = () => {
            try {
                tx.abort();
            } catch {
                // The transaction may already have settled.
            }
        };
        signal?.addEventListener("abort", abort, { once: true });
        try {
            const requests = operations.map((operation) => {
                const request =
                    operation.type === "put"
                        ? tx.store.put(operation.value, operation.key)
                        : tx.store.delete(operation.key);
                void request.catch((): void => undefined);
                return request;
            });
            await Promise.all([...requests, tx.done]);
        } catch (error) {
            abort();
            await settled;
            if (error instanceof DOMException && error.name === "AbortError") checkAbort(signal);
            throw error;
        } finally {
            signal?.removeEventListener("abort", abort);
        }
    }

    async getEntries<U>(
        query?: IDBValidKey | IDBKeyRange,
        count?: number
    ): Promise<Array<{ key: IDBValidKey; value: U }>> {
        const db = await this.DB;
        const tx = db.transaction(this.dbKey, "readonly");
        const settled = tx.done.catch((): void => undefined);
        try {
            const keys = tx.store.getAllKeys(query, count);
            void keys.catch((): void => undefined);
            const values = tx.store.getAll(query, count);
            const [orderedKeys, orderedValues] = await Promise.all([keys, values, tx.done]);
            return orderedKeys.map((key, index) => ({ key, value: orderedValues[index] as U }));
        } catch (error) {
            await settled;
            throw error;
        }
    }

    close(): Promise<void> {
        if (this.closing) return this.closing;
        if (this.closed) return Promise.resolve();
        this.closed = this.beforeOwnedStoreClose !== undefined;
        const connection = this.connection;
        this.connection = undefined;
        if (connection) ++this.epoch;
        const closing = (async () => {
            try {
                await this.beforeOwnedStoreClose?.(this.destroying);
            } finally {
                await connection?.then(
                    (db) => db.close(),
                    (): void => undefined
                );
            }
        })();
        this.closing = closing;
        const clear = () => {
            this.closing = undefined;
        };
        void closing.then(clear, clear);
        return closing;
    }

    destroy(): Promise<void> {
        if (this.destruction) return this.destruction;
        if (this.closed) return Promise.reject(new Error("Key-value database is closed"));
        this.destroying = true;
        this.destruction = (async () => {
            await this.close();
            await deleteDB(this.dbKey, {
                blocked: () => {
                    Logger(`Database delete blocked for ${this.dbKey}`);
                },
            });
        })();
        return this.destruction;
    }
}
