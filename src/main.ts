import { Plugin, type App, type PluginManifest } from "./deps";
import {
    type EntryDoc,
    type ObsidianLiveSyncSettings,
    type HasSettings,
    LOG_LEVEL_INFO,
} from "./lib/src/common/types.ts";
import { type SimpleStore } from "./lib/src/common/utils.ts";
import { type LiveSyncLocalDBEnv } from "./lib/src/pouchdb/LiveSyncLocalDB.ts";
import { type LiveSyncReplicatorEnv } from "./lib/src/replication/LiveSyncAbstractReplicator.js";
import { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
import { HiddenFileSync } from "./features/HiddenFileSync/CmdHiddenFileSync.ts";
import { ConfigSync } from "./features/ConfigSync/CmdConfigSync.ts";
import { type LiveSyncJournalReplicatorEnv } from "./lib/src/replication/journal/LiveSyncJournalReplicator.js";
import { type LiveSyncCouchDBReplicatorEnv } from "./lib/src/replication/couchdb/LiveSyncReplicator.js";
import type { CheckPointInfo } from "./lib/src/replication/journal/JournalSyncTypes.js";
import type { IObsidianModule } from "./modules/AbstractObsidianModule.ts";
import { ModuleDev } from "./modules/extras/ModuleDev.ts";
import { ModuleMigration } from "./modules/essential/ModuleMigration.ts";

import { ModuleCheckRemoteSize } from "./modules/essentialObsidian/ModuleCheckRemoteSize.ts";
import { ModuleConflictResolver } from "./modules/coreFeatures/ModuleConflictResolver.ts";
import { ModuleInteractiveConflictResolver } from "./modules/features/ModuleInteractiveConflictResolver.ts";
import { ModuleLog } from "./modules/features/ModuleLog.ts";
import { ModuleRedFlag } from "./modules/coreFeatures/ModuleRedFlag.ts";
import { ModuleObsidianMenu } from "./modules/essentialObsidian/ModuleObsidianMenu.ts";
import { ModuleSetupObsidian } from "./modules/features/ModuleSetupObsidian.ts";
import { SetupManager } from "./modules/features/SetupManager.ts";
import type { StorageAccess } from "@lib/interfaces/StorageAccess.ts";
import type { Confirm } from "./lib/src/interfaces/Confirm.ts";
import type { Rebuilder } from "@lib/interfaces/DatabaseRebuilder.ts";
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess.ts";
import { ModuleObsidianAPI } from "./modules/essentialObsidian/ModuleObsidianAPI.ts";
import { ModuleObsidianEvents } from "./modules/essentialObsidian/ModuleObsidianEvents.ts";
import { AbstractModule } from "./modules/AbstractModule.ts";
import { ModuleObsidianSettingDialogue } from "./modules/features/ModuleObsidianSettingTab.ts";
import { ModuleObsidianDocumentHistory } from "./modules/features/ModuleObsidianDocumentHistory.ts";
import { ModuleObsidianGlobalHistory } from "./modules/features/ModuleGlobalHistory.ts";
import { ModuleObsidianSettingsAsMarkdown } from "./modules/features/ModuleObsidianSettingAsMarkdown.ts";
import { ModuleInitializerFile } from "./modules/essential/ModuleInitializerFile.ts";
import { ModuleReplicator } from "./modules/core/ModuleReplicator.ts";
import { ModuleReplicatorCouchDB } from "./modules/core/ModuleReplicatorCouchDB.ts";
import { ModuleReplicatorMinIO } from "./modules/core/ModuleReplicatorMinIO.ts";
import { ModuleTargetFilter } from "./modules/core/ModuleTargetFilter.ts";
import { ModulePeriodicProcess } from "./modules/core/ModulePeriodicProcess.ts";
import { ModuleRemoteGovernor } from "./modules/coreFeatures/ModuleRemoteGovernor.ts";
import { ModuleConflictChecker } from "./modules/coreFeatures/ModuleConflictChecker.ts";
import { ModuleResolvingMismatchedTweaks } from "./modules/coreFeatures/ModuleResolveMismatchedTweaks.ts";
import { ModuleIntegratedTest } from "./modules/extras/ModuleIntegratedTest.ts";
import { ModuleReplicateTest } from "./modules/extras/ModuleReplicateTest.ts";
import { ModuleLiveSyncMain } from "./modules/main/ModuleLiveSyncMain.ts";
import { LocalDatabaseMaintenance } from "./features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts";
import { P2PReplicator } from "./features/P2PSync/CmdP2PReplicator.ts";
import type { InjectableServiceHub } from "./lib/src/services/implements/injectable/InjectableServiceHub.ts";
import { ObsidianServiceHub } from "./modules/services/ObsidianServiceHub.ts";
import type { ServiceContext } from "./lib/src/services/base/ServiceBase.ts";
import { ServiceRebuilder } from "@lib/serviceModules/Rebuilder.ts";
import type { IFileHandler } from "@lib/interfaces/FileHandler.ts";
import { ServiceDatabaseFileAccess } from "@/serviceModules/DatabaseFileAccess.ts";
import { ServiceFileAccessObsidian } from "@/serviceModules/ServiceFileAccessImpl.ts";
import { StorageAccessManager } from "@lib/managers/StorageProcessingManager.ts";
import { __$checkInstanceBinding } from "./lib/src/dev/checks.ts";
import { ServiceFileHandler } from "./serviceModules/FileHandler.ts";
import { FileAccessObsidian } from "./serviceModules/FileAccessObsidian.ts";
import { StorageEventManagerObsidian } from "./managers/StorageEventManagerObsidian.ts";
import { onLayoutReadyFeatures } from "./serviceFeatures/onLayoutReady.ts";
import type { ServiceModules } from "./types.ts";

export default class ObsidianLiveSyncPlugin
    extends Plugin
    implements
        LiveSyncLocalDBEnv,
        LiveSyncReplicatorEnv,
        LiveSyncJournalReplicatorEnv,
        LiveSyncCouchDBReplicatorEnv,
        HasSettings<ObsidianLiveSyncSettings>
{
    /**
     * The service hub for managing all services.
     */
    _services: InjectableServiceHub<ServiceContext> | undefined = undefined;

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
     * addOns: Non-essential and graphically features
     */
    addOns = [] as LiveSyncCommands[];

    /**
     * The modules of the plug-in. Modules are responsible for specific features or functionalities of the plug-in, such as file handling, conflict resolution, replication, etc.
     */
    private modules = [
        // Move to registerModules
    ] as (IObsidianModule | AbstractModule)[];

    /**
     * register an add-onn to the plug-in.
     * Add-ons are features that are not essential to the core functionality of the plugin,
     * @param addOn
     */
    private _registerAddOn(addOn: LiveSyncCommands) {
        this.addOns.push(addOn);
    }

    private registerAddOns() {
        this._registerAddOn(new ConfigSync(this));
        this._registerAddOn(new HiddenFileSync(this));
        this._registerAddOn(new LocalDatabaseMaintenance(this));
        this._registerAddOn(new P2PReplicator(this));
    }

    /**
     * Get an add-on by its class name. Returns undefined if not found.
     * @param cls
     * @returns
     */
    getAddOn<T extends LiveSyncCommands>(cls: string) {
        for (const addon of this.addOns) {
            if (addon.constructor.name == cls) return addon as T;
        }
        return undefined;
    }

    /**
     * Get a module by its class. Throws an error if not found.
     * Mostly used for getting SetupManager.
     * @param constructor
     * @returns
     */
    getModule<T extends IObsidianModule>(constructor: new (...args: any[]) => T): T {
        for (const module of this.modules) {
            if (module.constructor === constructor) return module as T;
        }
        throw new Error(`Module ${constructor} not found or not loaded.`);
    }

    /**
     * Register a module to the plug-in.
     * @param module The module to register.
     */
    private _registerModule(module: IObsidianModule) {
        this.modules.push(module);
    }
    private registerModules() {
        this._registerModule(new ModuleLiveSyncMain(this));
        this._registerModule(new ModuleConflictChecker(this));
        this._registerModule(new ModuleReplicatorMinIO(this));
        this._registerModule(new ModuleReplicatorCouchDB(this));
        this._registerModule(new ModuleReplicator(this));
        this._registerModule(new ModuleConflictResolver(this));
        this._registerModule(new ModuleRemoteGovernor(this));
        this._registerModule(new ModuleTargetFilter(this));
        this._registerModule(new ModulePeriodicProcess(this));
        this._registerModule(new ModuleInitializerFile(this));
        this._registerModule(new ModuleObsidianAPI(this, this));
        this._registerModule(new ModuleObsidianEvents(this, this));
        this._registerModule(new ModuleResolvingMismatchedTweaks(this));
        this._registerModule(new ModuleObsidianSettingsAsMarkdown(this));
        this._registerModule(new ModuleObsidianSettingDialogue(this, this));
        this._registerModule(new ModuleLog(this, this));
        this._registerModule(new ModuleObsidianMenu(this));
        this._registerModule(new ModuleSetupObsidian(this));
        this._registerModule(new ModuleObsidianDocumentHistory(this, this));
        this._registerModule(new ModuleMigration(this));
        this._registerModule(new ModuleRedFlag(this));
        this._registerModule(new ModuleInteractiveConflictResolver(this, this));
        this._registerModule(new ModuleObsidianGlobalHistory(this, this));
        this._registerModule(new ModuleCheckRemoteSize(this));
        // Test and Dev Modules
        this._registerModule(new ModuleDev(this, this));
        this._registerModule(new ModuleReplicateTest(this, this));
        this._registerModule(new ModuleIntegratedTest(this, this));
        this._registerModule(new SetupManager(this));
    }

    /**
     * Bind module functions to services.
     */
    private bindModuleFunctions() {
        for (const module of this.modules) {
            if (module instanceof AbstractModule) {
                module.onBindFunction(this, this.services);
                __$checkInstanceBinding(module); // Check if all functions are properly bound, and log warnings if not.
            } else {
                this.services.API.addLog(
                    `Module ${module.constructor.name} does not have onBindFunction, skipping binding.`,
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
     * @obsolete Use services.database.managers instead. The database managers, including entry manager, revision manager, etc.
     */
    get managers() {
        return this.services.database.managers;
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

    // requestCount = reactiveSource(0);
    // responseCount = reactiveSource(0);
    // totalQueued = reactiveSource(0);
    // batched = reactiveSource(0);
    // processing = reactiveSource(0);
    // databaseQueueCount = reactiveSource(0);
    // storageApplyingCount = reactiveSource(0);
    // replicationResultCount = reactiveSource(0);

    // pendingFileEventCount = reactiveSource(0);
    // processingFileEventCount = reactiveSource(0);

    // _totalProcessingCount?: ReactiveValue<number>;

    // replicationStat = reactiveSource({
    //     sent: 0,
    //     arrived: 0,
    //     maxPullSeq: 0,
    //     maxPushSeq: 0,
    //     lastSyncPullSeq: 0,
    //     lastSyncPushSeq: 0,
    //     syncStatus: "CLOSED" as DatabaseConnectingStatus,
    // });

    private initialiseServices() {
        this._services = new ObsidianServiceHub(this);
    }
    /**
     * Initialise service modules.
     */
    private initialiseServiceModules() {
        const storageAccessManager = new StorageAccessManager();
        // If we want to implement to the other platform, implement ObsidianXXXXXService.
        const vaultAccess = new FileAccessObsidian(this.app, {
            storageAccessManager: storageAccessManager,
            vaultService: this.services.vault,
            settingService: this.services.setting,
            APIService: this.services.API,
        });
        const storageEventManager = new StorageEventManagerObsidian(this, this, {
            fileProcessing: this.services.fileProcessing,
            setting: this.services.setting,
            vaultService: this.services.vault,
            storageAccessManager: storageAccessManager,
            APIService: this.services.API,
        });
        const storageAccess = new ServiceFileAccessObsidian({
            API: this.services.API,
            setting: this.services.setting,
            fileProcessing: this.services.fileProcessing,
            vault: this.services.vault,
            appLifecycle: this.services.appLifecycle,
            storageEventManager: storageEventManager,
            storageAccessManager: storageAccessManager,
            vaultAccess: vaultAccess,
        });

        const databaseFileAccess = new ServiceDatabaseFileAccess({
            API: this.services.API,
            database: this.services.database,
            path: this.services.path,
            storageAccess: storageAccess,
            vault: this.services.vault,
        });

        const fileHandler = new ServiceFileHandler({
            API: this.services.API,
            databaseFileAccess: databaseFileAccess,
            conflict: this.services.conflict,
            setting: this.services.setting,
            fileProcessing: this.services.fileProcessing,
            vault: this.services.vault,
            path: this.services.path,
            replication: this.services.replication,
            storageAccess: storageAccess,
        });
        const rebuilder = new ServiceRebuilder({
            API: this.services.API,
            database: this.services.database,
            appLifecycle: this.services.appLifecycle,
            setting: this.services.setting,
            remote: this.services.remote,
            databaseEvents: this.services.databaseEvents,
            replication: this.services.replication,
            replicator: this.services.replicator,
            UI: this.services.UI,
            vault: this.services.vault,
            fileHandler: fileHandler,
            storageAccess: storageAccess,
            control: this.services.control,
        });
        return {
            rebuilder,
            fileHandler,
            databaseFileAccess,
            storageAccess,
        };
    }

    /**
     * @obsolete Use services.setting.saveSettingData instead. Save the settings to the disk. This is usually called after changing the settings in the code, to persist the changes.
     */
    async saveSettings() {
        await this.services.setting.saveSettingData();
    }

    /**
     * Initialise ServiceFeatures.
     * (Please refer `serviceFeatures` for more details)
     */
    initialiseServiceFeatures() {
        for (const feature of onLayoutReadyFeatures) {
            const curriedFeature = () => feature(this);
            this.services.appLifecycle.onLayoutReady.addHandler(curriedFeature);
        }
    }

    constructor(app: App, manifest: PluginManifest) {
        super(app, manifest);
        this.initialiseServices();
        this.registerModules();
        this.registerAddOns();
        this._serviceModules = this.initialiseServiceModules();
        this.initialiseServiceFeatures();
        this.bindModuleFunctions();
    }

    private async _startUp() {
        if (!(await this.services.control.onLoad())) return;
        const onReady = this.services.control.onReady.bind(this.services.control);
        this.app.workspace.onLayoutReady(onReady);
    }
    onload() {
        void this._startUp();
    }
    onunload() {
        return void this.services.control.onUnload();
    }
}

// For now,
export type LiveSyncCore = ObsidianLiveSyncPlugin;
