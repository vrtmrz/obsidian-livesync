import { Plugin } from "./deps";
import {
    type EntryDoc,
    type ObsidianLiveSyncSettings,
    type DatabaseConnectingStatus,
    type HasSettings,
} from "./lib/src/common/types.ts";
import { type SimpleStore } from "./lib/src/common/utils.ts";
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "./lib/src/pouchdb/LiveSyncLocalDB.ts";
import {
    LiveSyncAbstractReplicator,
    type LiveSyncReplicatorEnv,
} from "./lib/src/replication/LiveSyncAbstractReplicator.js";
import { type KeyValueDatabase } from "./lib/src/interfaces/KeyValueDatabase.ts";
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
import { ModuleInputUIObsidian } from "./modules/coreObsidian/ModuleInputUIObsidian.ts";
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
import { ModuleKeyValueDB } from "./modules/essential/ModuleKeyValueDB.ts";
import { ModulePouchDB } from "./modules/core/ModulePouchDB.ts";
import { ModuleReplicator } from "./modules/core/ModuleReplicator.ts";
import { ModuleReplicatorCouchDB } from "./modules/core/ModuleReplicatorCouchDB.ts";
import { ModuleReplicatorMinIO } from "./modules/core/ModuleReplicatorMinIO.ts";
import { ModuleTargetFilter } from "./modules/core/ModuleTargetFilter.ts";
import { ModulePeriodicProcess } from "./modules/core/ModulePeriodicProcess.ts";
import { ModuleRemoteGovernor } from "./modules/coreFeatures/ModuleRemoteGovernor.ts";
import { ModuleLocalDatabaseObsidian } from "./modules/core/ModuleLocalDatabaseObsidian.ts";
import { ModuleConflictChecker } from "./modules/coreFeatures/ModuleConflictChecker.ts";
import { ModuleResolvingMismatchedTweaks } from "./modules/coreFeatures/ModuleResolveMismatchedTweaks.ts";
import { ModuleIntegratedTest } from "./modules/extras/ModuleIntegratedTest.ts";
import { ModuleRebuilder } from "./modules/core/ModuleRebuilder.ts";
import { ModuleReplicateTest } from "./modules/extras/ModuleReplicateTest.ts";
import { ModuleLiveSyncMain } from "./modules/main/ModuleLiveSyncMain.ts";
import { ModuleExtraSyncObsidian } from "./modules/extraFeaturesObsidian/ModuleExtraSyncObsidian.ts";
import { LocalDatabaseMaintenance } from "./features/LocalDatabaseMainte/CmdLocalDatabaseMainte.ts";
import { P2PReplicator } from "./features/P2PSync/CmdP2PReplicator.ts";
import type { LiveSyncManagers } from "./lib/src/managers/LiveSyncManagers.ts";
import { ObsidianServiceHub } from "./modules/services/ObsidianServices.ts";
import type { InjectableServiceHub } from "./lib/src/services/InjectableServices.ts";

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
    _services: InjectableServiceHub = new ObsidianServiceHub(this);
    get services() {
        return this._services;
    }
    /**
     * Bind functions to the service hub (for migration purpose).
     */
    // bindFunctions = (this.serviceHub as ObsidianServiceHub).bindFunctions.bind(this.serviceHub);

    // --> Module System
    getAddOn<T extends LiveSyncCommands>(cls: string) {
        for (const addon of this.addOns) {
            if (addon.constructor.name == cls) return addon as T;
        }
        return undefined;
    }

    // Keep order to display the dialogue in order.
    addOns = [
        new ConfigSync(this),
        new HiddenFileSync(this),
        new LocalDatabaseMaintenance(this),
        new P2PReplicator(this),
    ] as LiveSyncCommands[];

    modules = [
        new ModuleLiveSyncMain(this),
        new ModuleExtraSyncObsidian(this, this),
        // Only on Obsidian
        new ModuleDatabaseFileAccess(this),
        // Common
        new ModulePouchDB(this),
        new ModuleConflictChecker(this),
        new ModuleLocalDatabaseObsidian(this),
        new ModuleReplicatorMinIO(this),
        new ModuleReplicatorCouchDB(this),
        new ModuleReplicator(this),
        new ModuleFileHandler(this),
        new ModuleConflictResolver(this),
        new ModuleRemoteGovernor(this),
        new ModuleTargetFilter(this),
        new ModulePeriodicProcess(this),
        // Obsidian modules
        new ModuleKeyValueDB(this),
        new ModuleInitializerFile(this),
        new ModuleObsidianAPI(this, this),
        new ModuleObsidianEvents(this, this),
        new ModuleFileAccessObsidian(this, this),
        new ModuleObsidianSettings(this, this),
        new ModuleResolvingMismatchedTweaks(this),
        new ModuleObsidianSettingsAsMarkdown(this, this),
        new ModuleObsidianSettingDialogue(this, this),
        new ModuleLog(this, this),
        new ModuleInputUIObsidian(this, this),
        new ModuleObsidianMenu(this, this),
        new ModuleRebuilder(this),
        new ModuleSetupObsidian(this, this),
        new ModuleObsidianDocumentHistory(this, this),
        new ModuleMigration(this),
        new ModuleRedFlag(this),
        new ModuleInteractiveConflictResolver(this, this),
        new ModuleObsidianGlobalHistory(this, this),
        new ModuleCheckRemoteSize(this, this),
        // Test and Dev Modules
        new ModuleDev(this, this),
        new ModuleReplicateTest(this, this),
        new ModuleIntegratedTest(this, this),
        new SetupManager(this, this),
    ] as (IObsidianModule | AbstractModule)[];

    getModule<T extends IObsidianModule>(constructor: new (...args: any[]) => T): T {
        for (const module of this.modules) {
            if (module.constructor === constructor) return module as T;
        }
        throw new Error(`Module ${constructor} not found or not loaded.`);
    }

    settings!: ObsidianLiveSyncSettings;
    localDatabase!: LiveSyncLocalDB;
    managers!: LiveSyncManagers;
    simpleStore!: SimpleStore<CheckPointInfo>;
    replicator!: LiveSyncAbstractReplicator;
    confirm!: Confirm;
    storageAccess!: StorageAccess;
    databaseFileAccess!: DatabaseFileAccess;
    fileHandler!: ModuleFileHandler;
    rebuilder!: Rebuilder;

    kvDB!: KeyValueDatabase;
    getDatabase(): PouchDB.Database<EntryDoc> {
        return this.localDatabase.localDatabase;
    }
    getSettings(): ObsidianLiveSyncSettings {
        return this.settings;
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

    onload() {
        void this.services.appLifecycle.onLoad();
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
