// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { SimpleStore } from "@lib/common/utils";
import type { IKeyValueDBService, IVaultService } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import type { KeyValueDatabase } from "@lib/interfaces/KeyValueDatabase";
import type { InjectableDatabaseEventService } from "@lib/services/implements/injectable/InjectableDatabaseEventService";
import type { AppLifecycleServiceBase } from "@lib/services/implements/injectable/InjectableAppLifecycleService";
export interface KeyValueDBDependencies<T extends ServiceContext = ServiceContext> {
    databaseEvents: InjectableDatabaseEventService<T>;
    vault: IVaultService;
    appLifecycle: AppLifecycleServiceBase<T>;
}
/**
 * The KeyValueDBService provides methods for managing the local key-value database.
 * Please note that each event of database lifecycle is handled in DatabaseEventService.
 */
export declare abstract class KeyValueDBService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IKeyValueDBService {
    private _kvDB;
    private _simpleStore;
    get simpleStore(): SimpleStore<unknown, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    get kvDB(): KeyValueDatabase;
    private databaseEvents;
    private vault;
    private appLifecycle;
    private _log;
    private _everyOnResetDatabase;
    private tryCloseKvDB;
    private openKeyValueDB;
    private _onOtherDatabaseUnload;
    private _onOtherDatabaseClose;
    private _everyOnInitializeDatabase;
    private _everyOnloadAfterLoadSettings;
    constructor(context: T, dependencies: KeyValueDBDependencies<T>);
    openSimpleStore<T>(kind: string): {
        get: (key: string) => Promise<T>;
        set: (key: string, value: unknown) => Promise<void>;
        delete: (key: string) => Promise<void>;
        keys: (from: string | undefined, to: string | undefined, count?: number) => Promise<string[]>;
        db: Promise<KeyValueDatabase>;
    };
}
