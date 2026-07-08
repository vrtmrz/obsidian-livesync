// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { HasSettings, ObsidianLiveSyncSettings, EntryDoc } from "@lib/common/types";
import type { Confirm } from "@lib/interfaces/Confirm";
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess";
import type { Rebuilder } from "@lib/interfaces/DatabaseRebuilder";
import type { IFileHandler } from "@lib/interfaces/FileHandler";
import type { StorageAccess } from "@lib/interfaces/StorageAccess";
import type { LiveSyncLocalDBEnv } from "@lib/pouchdb/LiveSyncLocalDB";
import type { LiveSyncCouchDBReplicatorEnv } from "@lib/replication/couchdb/LiveSyncReplicator";
import type { CheckPointInfo } from "@lib/replication/journal/JournalSyncTypes";
import type { LiveSyncJournalReplicatorEnv } from "@lib/replication/journal/LiveSyncJournalReplicatorEnv";
import type { LiveSyncReplicatorEnv } from "@lib/replication/LiveSyncAbstractReplicator";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
import type { InjectableServiceHub } from "@lib/services/InjectableServices";
import { AbstractModule } from "./modules/AbstractModule";
import type { ServiceModules } from "@lib/interfaces/ServiceModule";
import type { Constructor } from "@lib/common/utils.type";
export declare class LiveSyncBaseCore<T extends ServiceContext = ServiceContext, TCommands extends IMinimumLiveSyncCommands = IMinimumLiveSyncCommands> implements LiveSyncLocalDBEnv, LiveSyncReplicatorEnv, LiveSyncJournalReplicatorEnv, LiveSyncCouchDBReplicatorEnv, HasSettings<ObsidianLiveSyncSettings> {
    addOns: TCommands[];
    /**
     * register an add-onn to the plug-in.
     * Add-ons are features that are not essential to the core functionality of the plugin,
     * @param addOn
     */
    private _registerAddOn;
    /**
     * Get an add-on by its class name. Returns undefined if not found.
     * @param cls
     * @returns
     */
    getAddOn<T extends TCommands>(cls: string): T | undefined;
    constructor(serviceHub: InjectableServiceHub<T>, serviceModuleInitialiser: (core: LiveSyncBaseCore<T, TCommands>, serviceHub: InjectableServiceHub<T>) => ServiceModules, extraModuleInitialiser: (core: LiveSyncBaseCore<T, TCommands>) => AbstractModule[], addOnsInitialiser: (core: LiveSyncBaseCore<T, TCommands>) => TCommands[], featuresInitialiser: (core: LiveSyncBaseCore<T, TCommands>) => void);
    /**
     * The service hub for managing all services.
     */
    _services: InjectableServiceHub<T> | undefined;
    get services(): InjectableServiceHub<T>;
    /**
     * Service Modules
     */
    protected _serviceModules: ServiceModules;
    get serviceModules(): ServiceModules;
    /**
     * The modules of the plug-in. Modules are responsible for specific features or functionalities of the plug-in, such as file handling, conflict resolution, replication, etc.
     */
    private modules;
    /**
     * Get a module by its class. Throws an error if not found.
     * Mostly used for getting SetupManager.
     * @param constructor
     * @returns
     */
    getModule<T extends AbstractModule>(constructor: Constructor<T>): T;
    /**
     * Register a module to the plug-in.
     * @param module The module to register.
     */
    private _registerModule;
    registerModules(extraModules?: AbstractModule[]): void;
    /**
     * Bind module functions to services.
     */
    bindModuleFunctions(): void;
    /**
     * @obsolete Use services.UI.confirm instead. The confirm function to show a confirmation dialog to the user.
     */
    get confirm(): Confirm;
    /**
     * @obsolete Use services.setting.currentSettings instead. The current settings of the plug-in.
     */
    get settings(): ObsidianLiveSyncSettings;
    /**
     * @obsolete Use services.setting.settings instead. Set the settings of the plug-in.
     */
    set settings(value: ObsidianLiveSyncSettings);
    /**
     * @obsolete Use services.setting.currentSettings instead. Get the settings of the plug-in.
     * @returns The current settings of the plug-in.
     */
    getSettings(): ObsidianLiveSyncSettings;
    /**
     * @obsolete Use services.database.localDatabase instead. The local database instance.
     */
    get localDatabase(): import("@lib/pouchdb/LiveSyncLocalDB").LiveSyncLocalDB;
    /**
     * @obsolete Use services.database.localDatabase instead. Get the PouchDB database instance. Note that this is not the same as the local database instance, which is a wrapper around the PouchDB database.
     * @returns The PouchDB database instance.
     */
    getDatabase(): PouchDB.Database<EntryDoc>;
    /**
     * @obsolete Use services.keyValueDB.simpleStore instead. A simple key-value store for storing non-file data, such as checkpoints, sync status, etc.
     */
    get simpleStore(): SimpleStore<CheckPointInfo>;
    /**
     * @obsolete Use services.replication.getActiveReplicator instead. Get the active replicator instance. Note that there can be multiple replicators, but only one can be active at a time.
     */
    get replicator(): import("@lib/replication/LiveSyncAbstractReplicator").LiveSyncAbstractReplicator;
    /**
     * @obsolete Use services.keyValueDB.kvDB instead. Get the key-value database instance. This is used for storing large data that cannot be stored in the simple store, such as file metadata, etc.
     */
    get kvDB(): import("./lib/src/interfaces/KeyValueDatabase").KeyValueDatabase;
    /**
     * Storage Accessor for handling file operations.
     * @obsolete Use serviceModules.storageAccess instead.
     */
    get storageAccess(): StorageAccess;
    /**
     * Database File Accessor for handling file operations related to the database, such as exporting the database, importing from a file, etc.
     * @obsolete Use serviceModules.databaseFileAccess instead.
     */
    get databaseFileAccess(): DatabaseFileAccess;
    /**
     * File Handler for handling file operations related to replication, such as resolving conflicts, applying changes from replication, etc.
     * @obsolete Use serviceModules.fileHandler instead.
     */
    get fileHandler(): IFileHandler;
    /**
     * Rebuilder for handling database rebuilding operations.
     * @obsolete Use serviceModules.rebuilder instead.
     */
    get rebuilder(): Rebuilder;
    /**
     * Initialise ServiceFeatures.
     * (Please refer `serviceFeatures` for more details)
     */
    initialiseServiceFeatures(): void;
}
export interface IMinimumLiveSyncCommands {
    onunload(): void;
    onload(): void | Promise<void>;
    constructor: {
        name: string;
    };
}
