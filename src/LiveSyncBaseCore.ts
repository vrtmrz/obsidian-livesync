import { LOG_LEVEL_INFO } from "octagonal-wheels/common/logger";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { HasSettings, ObsidianLiveSyncSettings, EntryDoc } from "./lib/src/common/types";
import { __$checkInstanceBinding } from "./lib/src/dev/checks";
import type { Confirm } from "./lib/src/interfaces/Confirm";
import type { DatabaseFileAccess } from "./lib/src/interfaces/DatabaseFileAccess";
import type { Rebuilder } from "./lib/src/interfaces/DatabaseRebuilder";
import type { IFileHandler } from "./lib/src/interfaces/FileHandler";
import type { StorageAccess } from "./lib/src/interfaces/StorageAccess";
import type { LiveSyncLocalDBEnv } from "./lib/src/pouchdb/LiveSyncLocalDB";
import type { LiveSyncCouchDBReplicatorEnv } from "./lib/src/replication/couchdb/LiveSyncReplicator";
import type { CheckPointInfo } from "./lib/src/replication/journal/JournalSyncTypes";
import type { LiveSyncJournalReplicatorEnv } from "./lib/src/replication/journal/LiveSyncJournalReplicatorEnv";
import type { LiveSyncReplicatorEnv } from "./lib/src/replication/LiveSyncAbstractReplicator";
import { useTargetFilters } from "./lib/src/serviceFeatures/targetFilter";
import type { ServiceContext } from "./lib/src/services/base/ServiceBase";
import type { InjectableServiceHub } from "./lib/src/services/InjectableServices";
import { AbstractModule } from "./modules/AbstractModule";
import { ModulePeriodicProcess } from "./modules/core/ModulePeriodicProcess";
import { ModuleReplicator } from "./modules/core/ModuleReplicator";
import { ModuleReplicatorCouchDB } from "./modules/core/ModuleReplicatorCouchDB";
import { ModuleReplicatorMinIO } from "./modules/core/ModuleReplicatorMinIO";
import { ModuleConflictChecker } from "./modules/coreFeatures/ModuleConflictChecker";
import { ModuleConflictResolver } from "./modules/coreFeatures/ModuleConflictResolver";
import { ModuleResolvingMismatchedTweaks } from "./modules/coreFeatures/ModuleResolveMismatchedTweaks";
import { ModuleLiveSyncMain } from "./modules/main/ModuleLiveSyncMain";
import type { ServiceModules } from "./lib/src/interfaces/ServiceModule";
import { ModuleBasicMenu } from "./modules/essential/ModuleBasicMenu";
import { usePrepareDatabaseForUse } from "./lib/src/serviceFeatures/prepareDatabaseForUse";

export class LiveSyncBaseCore<
    T extends ServiceContext = ServiceContext,
    TCommands extends IMinimumLiveSyncCommands = IMinimumLiveSyncCommands,
>
    implements
        LiveSyncLocalDBEnv,
        LiveSyncReplicatorEnv,
        LiveSyncJournalReplicatorEnv,
        LiveSyncCouchDBReplicatorEnv,
        HasSettings<ObsidianLiveSyncSettings>
{
    addOns = [] as TCommands[];

    /**
     * register an add-onn to the plug-in.
     * Add-ons are features that are not essential to the core functionality of the plugin,
     * @param addOn
     */
    private _registerAddOn(addOn: TCommands) {
        this.addOns.push(addOn);
        this.services.appLifecycle.onUnload.addHandler(() => Promise.resolve(addOn.onunload()).then(() => true));
    }

    /**
     * Get an add-on by its class name. Returns undefined if not found.
     * @param cls
     * @returns
     */
    getAddOn<T extends TCommands>(cls: string) {
        for (const addon of this.addOns) {
            if (addon.constructor.name == cls) return addon as T;
        }
        return undefined;
    }

    constructor(
        serviceHub: InjectableServiceHub<T>,
        serviceModuleInitialiser: (
            core: LiveSyncBaseCore<T, TCommands>,
            serviceHub: InjectableServiceHub<T>
        ) => ServiceModules,
        extraModuleInitialiser: (core: LiveSyncBaseCore<T, TCommands>) => AbstractModule[],
        addOnsInitialiser: (core: LiveSyncBaseCore<T, TCommands>) => TCommands[],
        featuresInitialiser: (core: LiveSyncBaseCore<T, TCommands>) => void
    ) {
        this._services = serviceHub;
        this._serviceModules = serviceModuleInitialiser(this, serviceHub);
        const extraModules = extraModuleInitialiser(this);
        this.registerModules(extraModules);
        this.initialiseServiceFeatures();
        featuresInitialiser(this);
        const addOns = addOnsInitialiser(this);
        for (const addOn of addOns) {
            this._registerAddOn(addOn);
        }
        this.bindModuleFunctions();
    }
    /**
     * The service hub for managing all services.
     */
    _services: InjectableServiceHub<T> | undefined = undefined;

    get services() {
        if (!this._services) {
            throw new Error("Services not initialised yet");
        }
        return this._services;
    }
    /**
     * Service Modules
     */
    protected _serviceModules: ServiceModules;

    get serviceModules() {
        return this._serviceModules;
    }

    /**
     * The modules of the plug-in. Modules are responsible for specific features or functionalities of the plug-in, such as file handling, conflict resolution, replication, etc.
     */
    private modules = [
        // Move to registerModules
    ] as AbstractModule[];

    /**
     * Get a module by its class. Throws an error if not found.
     * Mostly used for getting SetupManager.
     * @param constructor
     * @returns
     */
    getModule<T extends AbstractModule>(constructor: new (...args: any[]) => T): T {
        for (const module of this.modules) {
            if (module.constructor === constructor) return module as T;
        }
        throw new Error(`Module ${constructor} not found or not loaded.`);
    }

    /**
     * Register a module to the plug-in.
     * @param module The module to register.
     */
    private _registerModule(module: AbstractModule) {
        this.modules.push(module);
    }

    public registerModules(extraModules: AbstractModule[] = []) {
        this._registerModule(new ModuleLiveSyncMain(this));
        this._registerModule(new ModuleConflictChecker(this));
        this._registerModule(new ModuleReplicatorMinIO(this));
        this._registerModule(new ModuleReplicatorCouchDB(this));
        this._registerModule(new ModuleReplicator(this));
        this._registerModule(new ModuleConflictResolver(this));
        this._registerModule(new ModulePeriodicProcess(this));
        this._registerModule(new ModuleResolvingMismatchedTweaks(this));
        this._registerModule(new ModuleBasicMenu(this));

        for (const module of extraModules) {
            this._registerModule(module);
        }
        // Test and Dev Modules
    }

    /**
     * Bind module functions to services.
     */
    public bindModuleFunctions() {
        for (const module of this.modules) {
            if (module instanceof AbstractModule) {
                module.onBindFunction(this, this.services);
                __$checkInstanceBinding(module); // Check if all functions are properly bound, and log warnings if not.
            } else {
                this.services.API.addLog(
                    `Module ${(module as any)?.constructor?.name ?? "unknown"} does not have onBindFunction, skipping binding.`,
                    LOG_LEVEL_INFO
                );
            }
        }
    }
    /**
     * @obsolete Use services.UI.confirm instead. The confirm function to show a confirmation dialog to the user.
     */
    get confirm(): Confirm {
        return this.services.UI.confirm;
    }

    /**
     * @obsolete Use services.setting.currentSettings instead. The current settings of the plug-in.
     */
    get settings() {
        return this.services.setting.settings;
    }

    /**
     * @obsolete Use services.setting.settings instead. Set the settings of the plug-in.
     */
    set settings(value: ObsidianLiveSyncSettings) {
        this.services.setting.settings = value;
    }

    /**
     * @obsolete Use services.setting.currentSettings instead. Get the settings of the plug-in.
     * @returns The current settings of the plug-in.
     */
    getSettings(): ObsidianLiveSyncSettings {
        return this.settings;
    }

    /**
     * @obsolete Use services.database.localDatabase instead. The local database instance.
     */
    get localDatabase() {
        return this.services.database.localDatabase;
    }

    /**
     * @obsolete Use services.database.localDatabase instead. Get the PouchDB database instance. Note that this is not the same as the local database instance, which is a wrapper around the PouchDB database.
     * @returns The PouchDB database instance.
     */
    getDatabase(): PouchDB.Database<EntryDoc> {
        return this.localDatabase.localDatabase;
    }

    /**
     * @obsolete Use services.keyValueDB.simpleStore instead. A simple key-value store for storing non-file data, such as checkpoints, sync status, etc.
     */
    get simpleStore() {
        return this.services.keyValueDB.simpleStore as SimpleStore<CheckPointInfo>;
    }

    /**
     * @obsolete Use services.replication.getActiveReplicator instead. Get the active replicator instance. Note that there can be multiple replicators, but only one can be active at a time.
     */
    get replicator() {
        return this.services.replicator.getActiveReplicator()!;
    }

    /**
     * @obsolete Use services.keyValueDB.kvDB instead. Get the key-value database instance. This is used for storing large data that cannot be stored in the simple store, such as file metadata, etc.
     */
    get kvDB() {
        return this.services.keyValueDB.kvDB;
    }

    /// Modules which were relied on services
    /**
     * Storage Accessor for handling file operations.
     * @obsolete Use serviceModules.storageAccess instead.
     */
    get storageAccess(): StorageAccess {
        return this.serviceModules.storageAccess;
    }
    /**
     * Database File Accessor for handling file operations related to the database, such as exporting the database, importing from a file, etc.
     * @obsolete Use serviceModules.databaseFileAccess instead.
     */
    get databaseFileAccess(): DatabaseFileAccess {
        return this.serviceModules.databaseFileAccess;
    }
    /**
     * File Handler for handling file operations related to replication, such as resolving conflicts, applying changes from replication, etc.
     * @obsolete Use serviceModules.fileHandler instead.
     */
    get fileHandler(): IFileHandler {
        return this.serviceModules.fileHandler;
    }
    /**
     * Rebuilder for handling database rebuilding operations.
     * @obsolete Use serviceModules.rebuilder instead.
     */
    get rebuilder(): Rebuilder {
        return this.serviceModules.rebuilder;
    }

    // private initialiseServices<T extends ServiceContext>(serviceHub: InjectableServiceHub<T>) {
    //     this._services = serviceHub;
    // }
    /**
     * Initialise ServiceFeatures.
     * (Please refer `serviceFeatures` for more details)
     */
    initialiseServiceFeatures() {
        useTargetFilters(this);
        // enable target filter feature.
        usePrepareDatabaseForUse(this);
    }
}

export interface IMinimumLiveSyncCommands {
    onunload(): void;
    onload(): void | Promise<void>;
    constructor: { name: string };
}
