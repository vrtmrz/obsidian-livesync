import { Plugin, type App, type PluginManifest } from "./deps";
import {
    type EntryDoc,
    type ObsidianLiveSyncSettings,
    type DatabaseConnectingStatus,
    type HasSettings,
} from "./lib/src/common/types.ts";
import { type SimpleStore } from "./lib/src/common/utils.ts";
import { type LiveSyncLocalDBEnv } from "./lib/src/pouchdb/LiveSyncLocalDB.ts";
import { type LiveSyncReplicatorEnv } from "./lib/src/replication/LiveSyncAbstractReplicator.js";
import { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
import { HiddenFileSync } from "./features/HiddenFileSync/CmdHiddenFileSync.ts";
import { ConfigSync } from "./features/ConfigSync/CmdConfigSync.ts";
import { reactiveSource, type ReactiveValue } from "octagonal-wheels/dataobject/reactive";
import { type LiveSyncJournalReplicatorEnv } from "./lib/src/replication/journal/LiveSyncJournalReplicator.js";
import { type LiveSyncCouchDBReplicatorEnv } from "./lib/src/replication/couchdb/LiveSyncReplicator.js";
import type { CheckPointInfo } from "./lib/src/replication/journal/JournalSyncTypes.js";
import type { IObsidianModule } from "./modules/AbstractObsidianModule.ts";

import { ModuleDev } from "./modules/extras/ModuleDev.ts";
import { ModuleFileAccessObsidian } from "./modules/coreObsidian/ModuleFileAccessObsidian.ts";
import { ModuleMigration } from "./modules/essential/ModuleMigration.ts";

import { ModuleCheckRemoteSize } from "./modules/essentialObsidian/ModuleCheckRemoteSize.ts";
import { ModuleConflictResolver } from "./modules/coreFeatures/ModuleConflictResolver.ts";
import { ModuleInteractiveConflictResolver } from "./modules/features/ModuleInteractiveConflictResolver.ts";
import { ModuleLog } from "./modules/features/ModuleLog.ts";
import { ModuleObsidianSettings } from "./modules/features/ModuleObsidianSetting.ts";
import { ModuleRedFlag } from "./modules/coreFeatures/ModuleRedFlag.ts";
import { ModuleObsidianMenu } from "./modules/essentialObsidian/ModuleObsidianMenu.ts";
import { ModuleSetupObsidian } from "./modules/features/ModuleSetupObsidian.ts";
import { SetupManager } from "./modules/features/SetupManager.ts";
import type { StorageAccess } from "./modules/interfaces/StorageAccess.ts";
import type { Confirm } from "./lib/src/interfaces/Confirm.ts";
import type { Rebuilder } from "./modules/interfaces/DatabaseRebuilder.ts";
import type { DatabaseFileAccess } from "./modules/interfaces/DatabaseFileAccess.ts";
import { ModuleDatabaseFileAccess } from "./modules/core/ModuleDatabaseFileAccess.ts";
import { ModuleFileHandler } from "./modules/core/ModuleFileHandler.ts";
import { ModuleObsidianAPI } from "./modules/essentialObsidian/ModuleObsidianAPI.ts";
import { ModuleObsidianEvents } from "./modules/essentialObsidian/ModuleObsidianEvents.ts";
import { type AbstractModule } from "./modules/AbstractModule.ts";
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
import { ModuleRebuilder } from "./modules/core/ModuleRebuilder.ts";
import { ModuleReplicateTest } from "./modules/extras/ModuleReplicateTest.ts";
import { ModuleLiveSyncMain } from "./modules/main/ModuleLiveSyncMain.ts";
import { LocalDatabaseMaintenance } from "./features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts";
import { P2PReplicator } from "./features/P2PSync/CmdP2PReplicator.ts";
import type { InjectableServiceHub } from "./lib/src/services/implements/injectable/InjectableServiceHub.ts";
import { ObsidianServiceHub } from "./modules/services/ObsidianServiceHub.ts";
import type { ServiceContext } from "./lib/src/services/base/ServiceBase.ts";

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

    private initialiseServices() {
        this._services = new ObsidianServiceHub(this);
    }

    // Keep order to display the dialogue in order.
    addOns = [] as LiveSyncCommands[];
    /**
     * Bind functions to the service hub (for migration purpose).
     */
    // bindFunctions = (this.serviceHub as ObsidianServiceHub).bindFunctions.bind(this.serviceHub);

    private _registerAddOn(addOn: LiveSyncCommands) {
        this.addOns.push(addOn);
    }
    private registerAddOns() {
        this._registerAddOn(new ConfigSync(this));
        this._registerAddOn(new HiddenFileSync(this));
        this._registerAddOn(new LocalDatabaseMaintenance(this));
        this._registerAddOn(new P2PReplicator(this));
    }

    getAddOn<T extends LiveSyncCommands>(cls: string) {
        for (const addon of this.addOns) {
            if (addon.constructor.name == cls) return addon as T;
        }
        return undefined;
    }

    private modules = [
        // Move to registerModules
    ] as (IObsidianModule | AbstractModule)[];

    getModule<T extends IObsidianModule>(constructor: new (...args: any[]) => T): T {
        for (const module of this.modules) {
            if (module.constructor === constructor) return module as T;
        }
        throw new Error(`Module ${constructor} not found or not loaded.`);
    }
    getModulesByType<T extends IObsidianModule>(constructor: new (...args: any[]) => T): T[] {
        const matchedModules: T[] = [];
        for (const module of this.modules) {
            if (module instanceof constructor) matchedModules.push(module);
        }
        return matchedModules;
    }

    private _registerModule(module: IObsidianModule) {
        this.modules.push(module);
    }
    private registerModules() {
        this._registerModule(new ModuleLiveSyncMain(this));
        // Only on Obsidian
        this._registerModule(new ModuleDatabaseFileAccess(this));
        // Common
        this._registerModule(new ModuleConflictChecker(this));
        this._registerModule(new ModuleReplicatorMinIO(this));
        this._registerModule(new ModuleReplicatorCouchDB(this));
        this._registerModule(new ModuleReplicator(this));
        this._registerModule(new ModuleFileHandler(this));
        this._registerModule(new ModuleConflictResolver(this));
        this._registerModule(new ModuleRemoteGovernor(this));
        this._registerModule(new ModuleTargetFilter(this));
        this._registerModule(new ModulePeriodicProcess(this));
        // Essential Modules
        this._registerModule(new ModuleInitializerFile(this));
        this._registerModule(new ModuleObsidianAPI(this, this));
        this._registerModule(new ModuleObsidianEvents(this, this));
        this._registerModule(new ModuleFileAccessObsidian(this, this));
        this._registerModule(new ModuleObsidianSettings(this));
        this._registerModule(new ModuleResolvingMismatchedTweaks(this));
        this._registerModule(new ModuleObsidianSettingsAsMarkdown(this));
        this._registerModule(new ModuleObsidianSettingDialogue(this, this));
        this._registerModule(new ModuleLog(this, this));
        this._registerModule(new ModuleObsidianMenu(this));
        this._registerModule(new ModuleRebuilder(this));
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

    get confirm(): Confirm {
        return this.services.UI.confirm;
    }

    // This property will be changed from outside often, so will be set later.
    settings!: ObsidianLiveSyncSettings;

    getSettings(): ObsidianLiveSyncSettings {
        return this.settings;
    }

    get localDatabase() {
        return this.services.database.localDatabase;
    }

    get managers() {
        return this.services.database.managers;
    }

    getDatabase(): PouchDB.Database<EntryDoc> {
        return this.localDatabase.localDatabase;
    }

    get simpleStore() {
        return this.services.keyValueDB.simpleStore as SimpleStore<CheckPointInfo>;
    }

    get replicator() {
        return this.services.replicator.getActiveReplicator()!;
    }

    // initialised at ModuleFileAccessObsidian
    storageAccess!: StorageAccess;
    // initialised at ModuleDatabaseFileAccess
    databaseFileAccess!: DatabaseFileAccess;
    // initialised at ModuleFileHandler
    fileHandler!: ModuleFileHandler;
    // initialised at ModuleRebuilder
    rebuilder!: Rebuilder;

    get kvDB() {
        return this.services.keyValueDB.kvDB;
    }

    requestCount = reactiveSource(0);
    responseCount = reactiveSource(0);
    totalQueued = reactiveSource(0);
    batched = reactiveSource(0);
    processing = reactiveSource(0);
    databaseQueueCount = reactiveSource(0);
    storageApplyingCount = reactiveSource(0);
    replicationResultCount = reactiveSource(0);
    conflictProcessQueueCount = reactiveSource(0);
    pendingFileEventCount = reactiveSource(0);
    processingFileEventCount = reactiveSource(0);

    _totalProcessingCount?: ReactiveValue<number>;

    replicationStat = reactiveSource({
        sent: 0,
        arrived: 0,
        maxPullSeq: 0,
        maxPushSeq: 0,
        lastSyncPullSeq: 0,
        lastSyncPushSeq: 0,
        syncStatus: "CLOSED" as DatabaseConnectingStatus,
    });

    constructor(app: App, manifest: PluginManifest) {
        super(app, manifest);
        this.initialiseServices();
        this.registerModules();
        this.registerAddOns();
    }

    private async _startUp() {
        await this.services.appLifecycle.onLoad();
        const onReady = this.services.appLifecycle.onReady.bind(this.services.appLifecycle);
        this.app.workspace.onLayoutReady(onReady);
    }
    onload() {
        void this._startUp();
    }
    async saveSettings() {
        await this.services.setting.saveSettingData();
    }
    onunload() {
        return void this.services.appLifecycle.onAppUnload();
    }
    // <-- Plug-in's overrideable functions
}

// For now,
export type LiveSyncCore = ObsidianLiveSyncPlugin;
