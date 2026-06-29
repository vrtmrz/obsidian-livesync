// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { IDatabaseService, IPathService, IVaultService, openDatabaseParameters } from "./IService";
import { ServiceBase, type ServiceContext } from "./ServiceBase";
import { LiveSyncLocalDB } from "@lib/pouchdb/LiveSyncLocalDB";
import type { SettingService } from "./SettingService";
import type { APIService } from "./APIService";
import type { ObsidianLiveSyncSettings } from "@lib/common/models/setting.type";
export type DatabaseServiceDependencies = {
    path: IPathService;
    vault: IVaultService;
    setting: SettingService;
    API: APIService;
};
/**
 * The DatabaseService provides methods for managing the local database.
 * Please note that each event of database lifecycle is handled in DatabaseEventService.
 */
export declare abstract class DatabaseService<T extends ServiceContext = ServiceContext> extends ServiceBase<T> implements IDatabaseService {
    _log: (msg: unknown, level?: import("octagonal-wheels/common/logger").LOG_LEVEL, key?: string) => void;
    constructor(context: T, dependencies: DatabaseServiceDependencies);
    protected _localDatabase: LiveSyncLocalDB | null;
    protected services: DatabaseServiceDependencies;
    onOpenDatabase: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<(vaultName: string) => Promise<boolean>>;
    /**
     * Called after the local database has been reset.
     */
    onDatabaseReset: import("@lib/services/lib/HandlerUtils").BooleanMultipleHandlerFunction<() => Promise<boolean>>;
    get localDatabase(): LiveSyncLocalDB;
    get localDatabaseDirect(): LiveSyncLocalDB | null;
    protected modifyDatabaseOptions(settings: ObsidianLiveSyncSettings, name: string, options: PouchDB.Configuration.DatabaseConfiguration): {
        name: string;
        options: PouchDB.Configuration.DatabaseConfiguration;
    };
    createPouchDBInstance<T extends object>(name?: string, options?: PouchDB.Configuration.DatabaseConfiguration): PouchDB.Database<T>;
    openDatabase(params: openDatabaseParameters): Promise<boolean>;
    isDatabaseReady(): boolean;
    resetDatabase(): Promise<boolean>;
}
