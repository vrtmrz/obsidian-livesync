import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "@lib/common/logger";
import type { KeyValueDatabase } from "@lib/interfaces/KeyValueDatabase";
import type { IKeyValueDBService } from "@lib/services/base/IService";
import { ServiceBase, type ServiceContext } from "@lib/services/base/ServiceBase";
import type { InjectableAppLifecycleService } from "@lib/services/implements/injectable/InjectableAppLifecycleService";
import type { InjectableDatabaseEventService } from "@lib/services/implements/injectable/InjectableDatabaseEventService";
import type { IVaultService } from "@lib/services/base/IService";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

const NODE_KV_TYPED_KEY = "__nodeKvType";
const NODE_KV_VALUES_KEY = "values";

type SerializableContainer =
    | {
          [NODE_KV_TYPED_KEY]: "Set";
          [NODE_KV_VALUES_KEY]: unknown[];
      }
    | {
          [NODE_KV_TYPED_KEY]: "Uint8Array";
          [NODE_KV_VALUES_KEY]: number[];
      }
    | {
          [NODE_KV_TYPED_KEY]: "ArrayBuffer";
          [NODE_KV_VALUES_KEY]: number[];
      };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function serializeForNodeKV(value: unknown): unknown {
    if (value instanceof Set) {
        return {
            [NODE_KV_TYPED_KEY]: "Set",
            [NODE_KV_VALUES_KEY]: [...value].map((entry) => serializeForNodeKV(entry)),
        } satisfies SerializableContainer;
    }
    if (value instanceof Uint8Array) {
        return {
            [NODE_KV_TYPED_KEY]: "Uint8Array",
            [NODE_KV_VALUES_KEY]: Array.from(value),
        } satisfies SerializableContainer;
    }
    if (value instanceof ArrayBuffer) {
        return {
            [NODE_KV_TYPED_KEY]: "ArrayBuffer",
            [NODE_KV_VALUES_KEY]: Array.from(new Uint8Array(value)),
        } satisfies SerializableContainer;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => serializeForNodeKV(entry));
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeForNodeKV(v)]));
    }
    return value;
}

function deserializeFromNodeKV(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => deserializeFromNodeKV(entry));
    }
    if (!isRecord(value)) {
        return value;
    }

    const taggedType = value[NODE_KV_TYPED_KEY];
    const taggedValues = value[NODE_KV_VALUES_KEY];
    if (taggedType === "Set" && Array.isArray(taggedValues)) {
        return new Set(taggedValues.map((entry) => deserializeFromNodeKV(entry)));
    }
    if (taggedType === "Uint8Array" && Array.isArray(taggedValues)) {
        return Uint8Array.from(taggedValues);
    }
    if (taggedType === "ArrayBuffer" && Array.isArray(taggedValues)) {
        return Uint8Array.from(taggedValues).buffer;
    }

    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deserializeFromNodeKV(v)]));
}

class NodeFileKeyValueDatabase implements KeyValueDatabase {
    private filePath: string;
    private data = new Map<string, unknown>();

    constructor(filePath: string) {
        this.filePath = filePath;
        this.load();
    }

    private asKeyString(key: IDBValidKey): string {
        if (typeof key === "string") {
            return key;
        }
        return JSON.stringify(key);
    }

    private load() {
        try {
            const loaded = JSON.parse(nodeFs.readFileSync(this.filePath, "utf-8")) as Record<string, unknown>;
            this.data = new Map(Object.entries(loaded).map(([key, value]) => [key, deserializeFromNodeKV(value)]));
        } catch {
            this.data = new Map();
        }
    }

    private flush() {
        nodeFs.mkdirSync(nodePath.dirname(this.filePath), { recursive: true });
        const serializable = Object.fromEntries(
            [...this.data.entries()].map(([key, value]) => [key, serializeForNodeKV(value)])
        );
        nodeFs.writeFileSync(this.filePath, JSON.stringify(serializable, null, 2), "utf-8");
    }

    async get<T>(key: IDBValidKey): Promise<T> {
        return this.data.get(this.asKeyString(key)) as T;
    }

    async set<T>(key: IDBValidKey, value: T): Promise<IDBValidKey> {
        this.data.set(this.asKeyString(key), value);
        this.flush();
        return key;
    }

    async del(key: IDBValidKey): Promise<void> {
        this.data.delete(this.asKeyString(key));
        this.flush();
    }

    async clear(): Promise<void> {
        this.data.clear();
        this.flush();
    }

    private isIDBKeyRangeLike(value: unknown): value is { lower?: IDBValidKey; upper?: IDBValidKey } {
        return typeof value === "object" && value !== null && ("lower" in value || "upper" in value);
    }

    async keys(query?: IDBValidKey | IDBKeyRange, count?: number): Promise<IDBValidKey[]> {
        const allKeys = [...this.data.keys()];
        let filtered = allKeys;
        if (typeof query !== "undefined") {
            if (this.isIDBKeyRangeLike(query)) {
                const lower = query.lower?.toString() ?? "";
                const upper = query.upper?.toString() ?? "\uffff";
                filtered = filtered.filter((key) => key >= lower && key <= upper);
            } else {
                const exact = query.toString();
                filtered = filtered.filter((key) => key === exact);
            }
        }
        if (typeof count === "number") {
            filtered = filtered.slice(0, count);
        }
        return filtered;
    }

    async close(): Promise<void> {
        this.flush();
    }

    async destroy(): Promise<void> {
        this.data.clear();
        nodeFs.rmSync(this.filePath, { force: true });
    }
}

export interface NodeKeyValueDBDependencies<T extends ServiceContext = ServiceContext> {
    databaseEvents: InjectableDatabaseEventService<T>;
    vault: IVaultService;
    appLifecycle: InjectableAppLifecycleService<T>;
}

export class NodeKeyValueDBService<T extends ServiceContext = ServiceContext>
    extends ServiceBase<T>
    implements IKeyValueDBService
{
    private _kvDB: KeyValueDatabase | undefined;
    private _simpleStore: SimpleStore<any> | undefined;
    private filePath: string;
    private _log = createInstanceLogFunction("NodeKeyValueDBService");

    get simpleStore() {
        if (!this._simpleStore) {
            throw new Error("SimpleStore is not initialized yet");
        }
        return this._simpleStore;
    }

    get kvDB() {
        if (!this._kvDB) {
            throw new Error("KeyValueDB is not initialized yet");
        }
        return this._kvDB;
    }

    constructor(context: T, dependencies: NodeKeyValueDBDependencies<T>, filePath: string) {
        super(context);
        this.filePath = filePath;

        dependencies.databaseEvents.onResetDatabase.addHandler(this._everyOnResetDatabase.bind(this));
        dependencies.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        dependencies.databaseEvents.onDatabaseInitialisation.addHandler(this._everyOnInitializeDatabase.bind(this));
        dependencies.databaseEvents.onUnloadDatabase.addHandler(this._onOtherDatabaseUnload.bind(this));
        dependencies.databaseEvents.onCloseDatabase.addHandler(this._onOtherDatabaseClose.bind(this));
    }

    private async openKeyValueDB(): Promise<boolean> {
        try {
            this._kvDB = new NodeFileKeyValueDatabase(this.filePath);
            return true;
        } catch (ex) {
            this._log("Failed to open Node key-value database", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    private async _everyOnResetDatabase(): Promise<boolean> {
        try {
            await this._kvDB?.del("queued-files");
            await this._kvDB?.destroy();
            return await this.openKeyValueDB();
        } catch (ex) {
            this._log("Failed to reset Node key-value database", LOG_LEVEL_NOTICE);
            this._log(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }

    private async _onOtherDatabaseUnload(): Promise<boolean> {
        await this._kvDB?.close();
        return true;
    }

    private async _onOtherDatabaseClose(): Promise<boolean> {
        await this._kvDB?.close();
        return true;
    }

    private _everyOnInitializeDatabase(): Promise<boolean> {
        return this.openKeyValueDB();
    }

    private async _everyOnloadAfterLoadSettings(): Promise<boolean> {
        if (!(await this.openKeyValueDB())) {
            return false;
        }
        this._simpleStore = this.openSimpleStore<any>("os");
        return true;
    }

    openSimpleStore<T>(kind: string): SimpleStore<T> {
        const getDB = () => {
            if (!this._kvDB) {
                throw new Error("KeyValueDB is not initialized yet");
            }
            return this._kvDB;
        };
        const prefix = `${kind}-`;
        return {
            get: async (key: string): Promise<T> => {
                return await getDB().get(`${prefix}${key}`);
            },
            set: async (key: string, value: any): Promise<void> => {
                await getDB().set(`${prefix}${key}`, value);
            },
            delete: async (key: string): Promise<void> => {
                await getDB().del(`${prefix}${key}`);
            },
            keys: async (from: string | undefined, to: string | undefined, count?: number): Promise<string[]> => {
                const allKeys = (await getDB().keys(undefined, count)).map((e) => e.toString());
                const lower = `${prefix}${from ?? ""}`;
                const upper = `${prefix}${to ?? "\uffff"}`;
                return allKeys
                    .filter((key) => key.startsWith(prefix))
                    .filter((key) => key >= lower && key <= upper)
                    .map((key) => key.substring(prefix.length));
            },
            db: Promise.resolve(getDB()),
        } satisfies SimpleStore<T>;
    }
}
