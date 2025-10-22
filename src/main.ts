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

import { ModuleCheckRemoteSize } from "./modules/coreFeatures/ModuleCheckRemoteSize.ts";
import { ModuleConflictResolver } from "./modules/coreFeatures/ModuleConflictResolver.ts";
import { ModuleInteractiveConflictResolver } from "./modules/features/ModuleInteractiveConflictResolver.ts";
import { ModuleLog } from "./modules/features/ModuleLog.ts";
import { ModuleObsidianSettings } from "./modules/features/ModuleObsidianSetting.ts";
import { ModuleRedFlag } from "./modules/coreFeatures/ModuleRedFlag.ts";
import { ModuleObsidianMenu } from "./modules/essentialObsidian/ModuleObsidianMenu.ts";
import { ModuleSetupObsidian, SetupManager } from "./modules/features/ModuleSetupObsidian.ts";
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

// function throwShouldBeOverridden(): never {
//     throw new Error("This function should be overridden by the module.");
// }
// const InterceptiveAll = Promise.resolve(true);
// const InterceptiveEvery = Promise.resolve(true);
// const InterceptiveAny = Promise.resolve(undefined);

/**
 * All $prefixed functions are hooked by the modules. Be careful to call them directly.
 * Please refer to the module's source code to understand the function.
 * $$     : Completely overridden functions.
 * $all   : Process all modules and return all results.
 * $every : Process all modules until the first failure.
 * $any   : Process all modules until the first success.
 * $      : Other interceptive points. You should manually assign the module
 * All of above performed on injectModules function.
 *
 * No longer used! See AppLifecycleService in Services.ts.
 * For a while, just commented out some previously used code. (sorry, some are deleted...)
 * 'Convention over configuration' was a lie for me. At least, very lack of refactor-ability.
 *
 * Still some modules are separated, and connected by `ThroughHole` class.
 * However, it is not a good design. I am going to manage the modules in a more explicit way.
 */

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
        // Common modules
        // Note: Platform-dependent functions are not entirely dependent on the core only, as they are from platform-dependent modules. Stubbing is sometimes required.
        new ModuleCheckRemoteSize(this),
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
    // injected = injectModules(this, [...this.modules, ...this.addOns] as ICoreModule[]);
    // <-- Module System

    // Following are plugged by the modules.

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

    // --> Events

    /* 
        LifeCycle of the plugin
        0. onunload (Obsidian Kicks.)
        1. onLiveSyncLoad
        2. (event) EVENT_PLUGIN_LOADED
        3. $everyOnloadStart
         -- Load settings
         -- Open database
           --
        3. $everyOnloadAfterLoadSettings
        4. $everyOnload
        5. (addOns) onload
        --
        onLiveSyncReady
          -- $everyOnLayoutReady
            -- EVENT_LAYOUT_READY
            (initializeDatabase)
            -- $everyOnFirstInitialize
            -- realizeSettingSyncMode
            -- waitForReplicationOnce (if syncOnStart and not LiveSync)
            -- scanStat (Not waiting for the result)

        --- 

        Finalization
        0. onunload (Obsidian Kicks.)
        1. onLiveSyncUnload
        2. (event) EVENT_PLUGIN_UNLOADED
        3. $allStartOnUnload
        4. $allOnUnload
        5. (addOns) onunload
        6. localDatabase.onunload
        7. replicator.closeReplication
        8. localDatabase.close
        9. (event) EVENT_PLATFORM_UNLOADED

    */

    // $everyOnLayoutReady(): Promise<boolean> {
    //     //TODO: AppLifecycleService.onLayoutReady
    //     return InterceptiveEvery;
    // }
    // $everyOnFirstInitialize(): Promise<boolean> {
    //     //TODO: AppLifecycleService.onFirstInitialize
    //     return InterceptiveEvery;
    // }

    // Some Module should call this function to start the plugin.
    // $$onLiveSyncReady(): Promise<false | undefined> {
    //     //TODO: AppLifecycleService.onLiveSyncReady
    //     throwShouldBeOverridden();
    // }
    // $$wireUpEvents(): void {
    //     //TODO: AppLifecycleService.wireUpEvents
    //     throwShouldBeOverridden();
    // }
    // $$onLiveSyncLoad(): Promise<void> {
    //     //TODO: AppLifecycleService.onLoad
    //     throwShouldBeOverridden();
    // }

    // $$onLiveSyncUnload(): Promise<void> {
    //     //TODO: AppLifecycleService.onAppUnload
    //     throwShouldBeOverridden();
    // }

    // $allScanStat(): Promise<boolean> {
    //     //TODO: AppLifecycleService.scanStartupIssues
    //     return InterceptiveAll;
    // }
    // $everyOnloadStart(): Promise<boolean> {
    //     //TODO: AppLifecycleService.onInitialise
    //     return InterceptiveEvery;
    // }

    // $everyOnloadAfterLoadSettings(): Promise<boolean> {
    //     //TODO: AppLifecycleService.onApplyStartupLoaded
    //     return InterceptiveEvery;
    // }

    // $everyOnload(): Promise<boolean> {
    //     //TODO: AppLifecycleService.onLoaded
    //     return InterceptiveEvery;
    // }

    // $anyHandlerProcessesFileEvent(item: FileEventItem): Promise<boolean | undefined> {
    //     //TODO: FileProcessingService.processFileEvent
    //     return InterceptiveAny;
    // }

    // $allStartOnUnload(): Promise<boolean> {
    //     //TODO: AppLifecycleService.onBeforeUnload
    //     return InterceptiveAll;
    // }
    // $allOnUnload(): Promise<boolean> {
    //     //TODO: AppLifecycleService.onUnload
    //     return InterceptiveAll;
    // }

    // $$openDatabase(): Promise<boolean> {
    //     // DatabaseService.openDatabase
    //     throwShouldBeOverridden();
    // }

    // $$realizeSettingSyncMode(): Promise<void> {
    //     // SettingService.realiseSetting
    //     throwShouldBeOverridden();
    // }
    // $$performRestart() {
    //     // AppLifecycleService.performRestart
    //     throwShouldBeOverridden();
    // }

    // $$clearUsedPassphrase(): void {
    //     // SettingService.clearUsedPassphrase
    //     throwShouldBeOverridden();
    // }

    // $$decryptSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> {
    //     // SettingService.decryptSettings
    //     throwShouldBeOverridden();
    // }
    // $$adjustSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings> {
    //     // SettingService.adjustSettings
    //     throwShouldBeOverridden();
    // }

    // $$loadSettings(): Promise<void> {
    //     // SettingService.loadSettings
    //     throwShouldBeOverridden();
    // }

    // $$saveDeviceAndVaultName(): void {
    //     // SettingService.saveDeviceAndVaultName
    //     throwShouldBeOverridden();
    // }

    // $$saveSettingData(): Promise<void> {
    //     // SettingService.saveSettingData
    //     throwShouldBeOverridden();
    // }

    // $anyProcessOptionalFileEvent(path: FilePath): Promise<boolean | undefined> {
    //     // FileProcessingService.processOptionalFileEvent
    //     return InterceptiveAny;
    // }

    // $everyCommitPendingFileEvent(): Promise<boolean> {
    //     // FileProcessingService.commitPendingFileEvent
    //     return InterceptiveEvery;
    // }

    // ->
    // $anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | undefined | "newer"> {
    //     return InterceptiveAny;
    // }

    // $$queueConflictCheckIfOpen(file: FilePathWithPrefix): Promise<void> {
    //     // ConflictEventManager.queueCheckForConflictIfOpen
    //     throwShouldBeOverridden();
    // }

    // $$queueConflictCheck(file: FilePathWithPrefix): Promise<void> {
    //     // ConflictEventManager.queueCheckForConflict
    //     throwShouldBeOverridden();
    // }

    // $$waitForAllConflictProcessed(): Promise<boolean> {
    //     // ConflictEventManager.ensureAllConflictProcessed
    //     throwShouldBeOverridden();
    // }

    //<-- Conflict Check

    // $anyProcessOptionalSyncFiles(doc: LoadedEntry): Promise<boolean | undefined> {
    //     // ReplicationService.processOptionalSyncFile
    //     return InterceptiveAny;
    // }

    // $anyProcessReplicatedDoc(doc: MetaEntry): Promise<boolean | undefined> {
    //     // ReplicationService.processReplicatedDocument
    //     return InterceptiveAny;
    // }

    //---> Sync
    // $$parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void {
    //     // ReplicationService.parseSynchroniseResult
    //     throwShouldBeOverridden();
    // }

    // $anyModuleParsedReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>): Promise<boolean | undefined> {
    //     // ReplicationService.processVirtualDocument
    //     return InterceptiveAny;
    // }
    // $everyBeforeRealizeSetting(): Promise<boolean> {
    //     // SettingEventManager.beforeRealiseSetting
    //     return InterceptiveEvery;
    // }
    // $everyAfterRealizeSetting(): Promise<boolean> {
    //     // SettingEventManager.onSettingRealised
    //     return InterceptiveEvery;
    // }
    // $everyRealizeSettingSyncMode(): Promise<boolean> {
    //     // SettingEventManager.onRealiseSetting
    //     return InterceptiveEvery;
    // }

    // $everyBeforeSuspendProcess(): Promise<boolean> {
    //     // AppLifecycleService.onSuspending
    //     return InterceptiveEvery;
    // }
    // $everyOnResumeProcess(): Promise<boolean> {
    //     // AppLifecycleService.onResuming
    //     return InterceptiveEvery;
    // }
    // $everyAfterResumeProcess(): Promise<boolean> {
    //     // AppLifecycleService.onResumed
    //     return InterceptiveEvery;
    // }

    // $$fetchRemotePreferredTweakValues(trialSetting: RemoteDBSettings): Promise<TweakValues | false> {
    //     //TODO:TweakValueService.fetchRemotePreferred
    //     throwShouldBeOverridden();
    // }
    // $$checkAndAskResolvingMismatchedTweaks(preferred: Partial<TweakValues>): Promise<[TweakValues | boolean, boolean]> {
    //     //TODO:TweakValueService.checkAndAskResolvingMismatched
    //     throwShouldBeOverridden();
    // }
    // $$askResolvingMismatchedTweaks(preferredSource: TweakValues): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
    //     //TODO:TweakValueService.askResolvingMismatched
    //     throwShouldBeOverridden();
    // }

    // $$checkAndAskUseRemoteConfiguration(
    //     settings: RemoteDBSettings
    // ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
    //     // TweakValueService.checkAndAskUseRemoteConfiguration
    //     throwShouldBeOverridden();
    // }

    // $$askUseRemoteConfiguration(
    //     trialSetting: RemoteDBSettings,
    //     preferred: TweakValues
    // ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
    //     // TweakValueService.askUseRemoteConfiguration
    //     throwShouldBeOverridden();
    // }
    // $everyBeforeReplicate(showMessage: boolean): Promise<boolean> {
    //     // ReplicationService.beforeReplicate
    //     return InterceptiveEvery;
    // }

    // $$canReplicate(showMessage: boolean = false): Promise<boolean> {
    //     // ReplicationService.isReplicationReady
    //     throwShouldBeOverridden();
    // }

    // $$replicate(showMessage: boolean = false): Promise<boolean | void> {
    //     // ReplicationService.replicate
    //     throwShouldBeOverridden();
    // }
    // $$replicateByEvent(showMessage: boolean = false): Promise<boolean | void> {
    //     // ReplicationService.replicateByEvent
    //     throwShouldBeOverridden();
    // }

    // $everyOnDatabaseInitialized(showingNotice: boolean): Promise<boolean> {
    //   // DatabaseEventService.onDatabaseInitialised
    //     throwShouldBeOverridden();
    // }

    // $$initializeDatabase(
    //     showingNotice: boolean = false,
    //     reopenDatabase = true,
    //     ignoreSuspending: boolean = false
    // ): Promise<boolean> {
    //     // DatabaseEventService.initializeDatabase
    //     throwShouldBeOverridden();
    // }

    // $anyAfterConnectCheckFailed(): Promise<boolean | "CHECKAGAIN" | undefined> {
    //     // ReplicationService.checkConnectionFailure
    //     return InterceptiveAny;
    // }

    // $$replicateAllToServer(
    //     showingNotice: boolean = false,
    //     sendChunksInBulkDisabled: boolean = false
    // ): Promise<boolean> {
    //     // RemoteService.replicateAllToRemote
    //     throwShouldBeOverridden();
    // }
    // $$replicateAllFromServer(showingNotice: boolean = false): Promise<boolean> {
    //     // RemoteService.replicateAllFromRemote
    //     throwShouldBeOverridden();
    // }

    // Remote Governing
    // $$markRemoteLocked(lockByClean: boolean = false): Promise<void> {
    //     // RemoteService.markLocked;
    //     throwShouldBeOverridden();
    // }

    // $$markRemoteUnlocked(): Promise<void> {
    //     // RemoteService.markUnlocked;
    //     throwShouldBeOverridden();
    // }

    // $$markRemoteResolved(): Promise<void> {
    //     // RemoteService.markResolved;
    //     throwShouldBeOverridden();
    // }

    // <-- Remote Governing

    // $$isFileSizeExceeded(size: number): boolean {
    //     // VaultService.isFileSizeTooLarge
    //     throwShouldBeOverridden();
    // }

    // $$performFullScan(showingNotice?: boolean, ignoreSuspending?: boolean): Promise<void> {
    //     // VaultService.scanVault
    //     throwShouldBeOverridden();
    // }

    // $anyResolveConflictByUI(
    //     filename: FilePathWithPrefix,
    //     conflictCheckResult: diff_result
    // ): Promise<boolean | undefined> {
    //     // ConflictService.resolveConflictByUserInteraction
    //     return InterceptiveAny;
    // }
    // $$resolveConflictByDeletingRev(
    //     path: FilePathWithPrefix,
    //     deleteRevision: string,
    //     subTitle = ""
    // ): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED> {
    //     // ConflictService.resolveByDeletingRevision
    //     throwShouldBeOverridden();
    // }
    // $$resolveConflict(filename: FilePathWithPrefix): Promise<void> {
    //     // ConflictService.resolveConflict
    //     throwShouldBeOverridden();
    // }
    // $anyResolveConflictByNewest(filename: FilePathWithPrefix): Promise<boolean> {
    //     // ConflictService.resolveByNewest
    //     throwShouldBeOverridden();
    // }

    // $$resetLocalDatabase(): Promise<void> {
    //     // DatabaseService.resetDatabase;
    //     throwShouldBeOverridden();
    // }

    // $$tryResetRemoteDatabase(): Promise<void> {
    //     // RemoteService.tryResetDatabase;
    //     throwShouldBeOverridden();
    // }

    // $$tryCreateRemoteDatabase(): Promise<void> {
    //     // RemoteService.tryCreateDatabase;
    //     throwShouldBeOverridden();
    // }

    // $$isIgnoredByIgnoreFiles(file: string | UXFileInfoStub): Promise<boolean> {
    //     // VaultService.isIgnoredByIgnoreFiles
    //     throwShouldBeOverridden();
    // }

    // $$isTargetFile(file: string | UXFileInfoStub, keepFileCheckList = false): Promise<boolean> {
    //     // VaultService.isTargetFile
    //     throwShouldBeOverridden();
    // }

    // $$askReload(message?: string) {
    //     // AppLifecycleService.askRestart
    //     throwShouldBeOverridden();
    // }
    // $$scheduleAppReload() {
    //     // AppLifecycleService.scheduleRestart
    //     throwShouldBeOverridden();
    // }

    //--- Setup
    // $allSuspendAllSync(): Promise<boolean> {
    //     // SettingEventManager.suspendAllSync
    //     return InterceptiveAll;
    // }
    // $allSuspendExtraSync(): Promise<boolean> {
    //     // SettingEventManager.suspendExtraSync
    //     return InterceptiveAll;
    // }

    // $allAskUsingOptionalSyncFeature(opt: { enableFetch?: boolean; enableOverwrite?: boolean }): Promise<boolean> {
    //     // SettingEventManager.suggestOptionalFeatures
    //     throwShouldBeOverridden();
    // }
    // $anyConfigureOptionalSyncFeature(mode: string): Promise<void> {
    //     // SettingEventManager.enableOptionalFeature
    //     throwShouldBeOverridden();
    // }

    // $$showView(viewType: string): Promise<void> {
    //     // UIManager.showWindow //
    //     throwShouldBeOverridden();
    // }

    // For Development: Ensure reliability MORE AND MORE. May the this plug-in helps all of us.
    // $everyModuleTest(): Promise<boolean> {
    //     return InterceptiveEvery;
    // }
    // $everyModuleTestMultiDevice(): Promise<boolean> {
    //     return InterceptiveEvery;
    // }
    // $$addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void {
    //     throwShouldBeOverridden();
    // }

    // _isThisModuleEnabled(): boolean {
    //     return true;
    // }

    // $anyGetAppId(): Promise<string | undefined> {
    //     //  APIService.getAppId
    //     return InterceptiveAny;
    // }

    // Plug-in's overrideable functions
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
