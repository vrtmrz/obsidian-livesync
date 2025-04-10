import { Plugin } from "./deps";
import {
    type EntryDoc,
    type LoadedEntry,
    type ObsidianLiveSyncSettings,
    type LOG_LEVEL,
    type diff_result,
    type DatabaseConnectingStatus,
    type EntryHasPath,
    type DocumentID,
    type FilePathWithPrefix,
    type FilePath,
    LOG_LEVEL_INFO,
    type HasSettings,
    type MetaEntry,
    type UXFileInfoStub,
    type MISSING_OR_ERROR,
    type AUTO_MERGED,
    type RemoteDBSettings,
    type TweakValues,
    type CouchDBCredentials,
} from "./lib/src/common/types.ts";
import { type FileEventItem } from "./common/types.ts";
import { type SimpleStore } from "./lib/src/common/utils.ts";
import { LiveSyncLocalDB, type LiveSyncLocalDBEnv } from "./lib/src/pouchdb/LiveSyncLocalDB.ts";
import {
    LiveSyncAbstractReplicator,
    type LiveSyncReplicatorEnv,
} from "./lib/src/replication/LiveSyncAbstractReplicator.js";
import { type KeyValueDatabase } from "./common/KeyValueDB.ts";
import { LiveSyncCommands } from "./features/LiveSyncCommands.ts";
import { HiddenFileSync } from "./features/HiddenFileSync/CmdHiddenFileSync.ts";
import { ConfigSync } from "./features/ConfigSync/CmdConfigSync.ts";
import { reactiveSource, type ReactiveValue } from "./lib/src/dataobject/reactive.js";
import { type LiveSyncJournalReplicatorEnv } from "./lib/src/replication/journal/LiveSyncJournalReplicator.js";
import { type LiveSyncCouchDBReplicatorEnv } from "./lib/src/replication/couchdb/LiveSyncReplicator.js";
import type { CheckPointInfo } from "./lib/src/replication/journal/JournalSyncTypes.js";
import { ObsHttpHandler } from "./modules/essentialObsidian/APILib/ObsHttpHandler.js";
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
import { ModuleSetupObsidian } from "./modules/features/ModuleSetupObsidian.ts";
import type { StorageAccess } from "./modules/interfaces/StorageAccess.ts";
import type { Confirm } from "./lib/src/interfaces/Confirm.ts";
import type { Rebuilder } from "./modules/interfaces/DatabaseRebuilder.ts";
import type { DatabaseFileAccess } from "./modules/interfaces/DatabaseFileAccess.ts";
import { ModuleDatabaseFileAccess } from "./modules/core/ModuleDatabaseFileAccess.ts";
import { ModuleFileHandler } from "./modules/core/ModuleFileHandler.ts";
import { ModuleObsidianAPI } from "./modules/essentialObsidian/ModuleObsidianAPI.ts";
import { ModuleObsidianEvents } from "./modules/essentialObsidian/ModuleObsidianEvents.ts";
import { injectModules, type AbstractModule } from "./modules/AbstractModule.ts";
import type { ICoreModule } from "./modules/ModuleTypes.ts";
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

function throwShouldBeOverridden(): never {
    throw new Error("This function should be overridden by the module.");
}
const InterceptiveAll = Promise.resolve(true);
const InterceptiveEvery = Promise.resolve(true);
const InterceptiveAny = Promise.resolve(undefined);
/**
 * All $prefixed functions are hooked by the modules. Be careful to call them directly.
 * Please refer to the module's source code to understand the function.
 * $$     : Completely overridden functions.
 * $all   : Process all modules and return all results.
 * $every : Process all modules until the first failure.
 * $any   : Process all modules until the first success.
 * $      : Other interceptive points. You should manually assign the module
 * All of above performed on injectModules function.
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
    ] as (IObsidianModule | AbstractModule)[];
    injected = injectModules(this, [...this.modules, ...this.addOns] as ICoreModule[]);
    // <-- Module System

    $$isSuspended(): boolean {
        throwShouldBeOverridden();
    }

    $$setSuspended(value: boolean): void {
        throwShouldBeOverridden();
    }

    $$isDatabaseReady(): boolean {
        throwShouldBeOverridden();
    }

    $$getDeviceAndVaultName(): string {
        throwShouldBeOverridden();
    }
    $$setDeviceAndVaultName(name: string): void {
        throwShouldBeOverridden();
    }

    $$addLog(message: any, level: LOG_LEVEL = LOG_LEVEL_INFO, key = ""): void {
        throwShouldBeOverridden();
    }
    $$isReady(): boolean {
        throwShouldBeOverridden();
    }
    $$markIsReady(): void {
        throwShouldBeOverridden();
    }
    $$resetIsReady(): void {
        throwShouldBeOverridden();
    }

    // Following are plugged by the modules.

    settings!: ObsidianLiveSyncSettings;
    localDatabase!: LiveSyncLocalDB;
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

    $$markFileListPossiblyChanged(): void {
        throwShouldBeOverridden();
    }

    $$customFetchHandler(): ObsHttpHandler {
        throwShouldBeOverridden();
    }

    $$getLastPostFailedBySize(): boolean {
        throwShouldBeOverridden();
    }

    $$isStorageInsensitive(): boolean {
        throwShouldBeOverridden();
    }

    $$shouldCheckCaseInsensitive(): boolean {
        throwShouldBeOverridden();
    }

    $$isUnloaded(): boolean {
        throwShouldBeOverridden();
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

    $$isReloadingScheduled(): boolean {
        throwShouldBeOverridden();
    }
    $$getReplicator(): LiveSyncAbstractReplicator {
        throwShouldBeOverridden();
    }

    $$connectRemoteCouchDB(
        uri: string,
        auth: CouchDBCredentials,
        disableRequestURI: boolean,
        passphrase: string | false,
        useDynamicIterationCount: boolean,
        performSetup: boolean,
        skipInfo: boolean,
        compression: boolean,
        customHeaders: Record<string, string>
    ): Promise<
        | string
        | {
              db: PouchDB.Database<EntryDoc>;
              info: PouchDB.Core.DatabaseInfo;
          }
    > {
        throwShouldBeOverridden();
    }

    $$isMobile(): boolean {
        throwShouldBeOverridden();
    }
    $$vaultName(): string {
        throwShouldBeOverridden();
    }

    // --> Path

    $$getActiveFilePath(): FilePathWithPrefix | undefined {
        throwShouldBeOverridden();
    }

    // <-- Path

    // --> Path conversion
    $$id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix {
        throwShouldBeOverridden();
    }

    $$path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> {
        throwShouldBeOverridden();
    }

    // <!-- Path conversion

    // --> Database
    $$createPouchDBInstance<T extends object>(
        name?: string,
        options?: PouchDB.Configuration.DatabaseConfiguration
    ): PouchDB.Database<T> {
        throwShouldBeOverridden();
    }

    $allOnDBUnload(db: LiveSyncLocalDB): void {
        return;
    }
    $allOnDBClose(db: LiveSyncLocalDB): void {
        return;
    }

    // <!-- Database

    $anyNewReplicator(settingOverride: Partial<ObsidianLiveSyncSettings> = {}): Promise<LiveSyncAbstractReplicator> {
        throwShouldBeOverridden();
    }

    $everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return InterceptiveEvery;
    }

    $everyOnResetDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return InterceptiveEvery;
    }

    // end interfaces

    $$getVaultName(): string {
        throwShouldBeOverridden();
    }

    $$getSimpleStore<T>(kind: string): SimpleStore<T> {
        throwShouldBeOverridden();
    }
    // trench!: Trench;

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

    $everyOnLayoutReady(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $everyOnFirstInitialize(): Promise<boolean> {
        return InterceptiveEvery;
    }

    // Some Module should call this function to start the plugin.
    $$onLiveSyncReady(): Promise<false | undefined> {
        throwShouldBeOverridden();
    }
    $$wireUpEvents(): void {
        throwShouldBeOverridden();
    }
    $$onLiveSyncLoad(): Promise<void> {
        throwShouldBeOverridden();
    }

    $$onLiveSyncUnload(): Promise<void> {
        throwShouldBeOverridden();
    }

    $allScanStat(): Promise<boolean> {
        return InterceptiveAll;
    }
    $everyOnloadStart(): Promise<boolean> {
        return InterceptiveEvery;
    }

    $everyOnloadAfterLoadSettings(): Promise<boolean> {
        return InterceptiveEvery;
    }

    $everyOnload(): Promise<boolean> {
        return InterceptiveEvery;
    }

    $anyHandlerProcessesFileEvent(item: FileEventItem): Promise<boolean | undefined> {
        return InterceptiveAny;
    }

    $allStartOnUnload(): Promise<boolean> {
        return InterceptiveAll;
    }
    $allOnUnload(): Promise<boolean> {
        return InterceptiveAll;
    }

    $$openDatabase(): Promise<boolean> {
        throwShouldBeOverridden();
    }

    $$realizeSettingSyncMode(): Promise<void> {
        throwShouldBeOverridden();
    }
    $$performRestart() {
        throwShouldBeOverridden();
    }

    $$clearUsedPassphrase(): void {
        throwShouldBeOverridden();
    }
    $$loadSettings(): Promise<void> {
        throwShouldBeOverridden();
    }

    $$saveDeviceAndVaultName(): void {
        throwShouldBeOverridden();
    }

    $$saveSettingData(): Promise<void> {
        throwShouldBeOverridden();
    }

    $anyProcessOptionalFileEvent(path: FilePath): Promise<boolean | undefined> {
        return InterceptiveAny;
    }

    $everyCommitPendingFileEvent(): Promise<boolean> {
        return InterceptiveEvery;
    }

    // ->
    $anyGetOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | undefined | "newer"> {
        return InterceptiveAny;
    }

    $$queueConflictCheckIfOpen(file: FilePathWithPrefix): Promise<void> {
        throwShouldBeOverridden();
    }

    $$queueConflictCheck(file: FilePathWithPrefix): Promise<void> {
        throwShouldBeOverridden();
    }

    $$waitForAllConflictProcessed(): Promise<boolean> {
        throwShouldBeOverridden();
    }

    //<-- Conflict Check

    $anyProcessOptionalSyncFiles(doc: LoadedEntry): Promise<boolean | undefined> {
        return InterceptiveAny;
    }

    $anyProcessReplicatedDoc(doc: MetaEntry): Promise<boolean | undefined> {
        return InterceptiveAny;
    }

    //---> Sync
    $$parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void {
        throwShouldBeOverridden();
    }

    $anyModuleParsedReplicationResultItem(docs: PouchDB.Core.ExistingDocument<EntryDoc>): Promise<boolean | undefined> {
        return InterceptiveAny;
    }
    $everyBeforeRealizeSetting(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $everyAfterRealizeSetting(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $everyRealizeSettingSyncMode(): Promise<boolean> {
        return InterceptiveEvery;
    }

    $everyBeforeSuspendProcess(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $everyOnResumeProcess(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $everyAfterResumeProcess(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $$checkAndAskResolvingMismatchedTweaks(preferred: Partial<TweakValues>): Promise<[TweakValues | boolean, boolean]> {
        throwShouldBeOverridden();
    }
    $$askResolvingMismatchedTweaks(preferredSource: TweakValues): Promise<"OK" | "CHECKAGAIN" | "IGNORE"> {
        throwShouldBeOverridden();
    }

    $$checkAndAskUseRemoteConfiguration(
        settings: RemoteDBSettings
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        throwShouldBeOverridden();
    }

    $$askUseRemoteConfiguration(
        trialSetting: RemoteDBSettings,
        preferred: TweakValues
    ): Promise<{ result: false | TweakValues; requireFetch: boolean }> {
        throwShouldBeOverridden();
    }
    $everyBeforeReplicate(showMessage: boolean): Promise<boolean> {
        return InterceptiveEvery;
    }
    $$replicate(showMessage: boolean = false): Promise<boolean | void> {
        throwShouldBeOverridden();
    }
    $$replicateByEvent(showMessage: boolean = false): Promise<boolean | void> {
        throwShouldBeOverridden();
    }

    $everyOnDatabaseInitialized(showingNotice: boolean): Promise<boolean> {
        throwShouldBeOverridden();
    }

    $$initializeDatabase(showingNotice: boolean = false, reopenDatabase = true): Promise<boolean> {
        throwShouldBeOverridden();
    }

    $anyAfterConnectCheckFailed(): Promise<boolean | "CHECKAGAIN" | undefined> {
        return InterceptiveAny;
    }

    $$replicateAllToServer(
        showingNotice: boolean = false,
        sendChunksInBulkDisabled: boolean = false
    ): Promise<boolean> {
        throwShouldBeOverridden();
    }
    $$replicateAllFromServer(showingNotice: boolean = false): Promise<boolean> {
        throwShouldBeOverridden();
    }

    // Remote Governing
    $$markRemoteLocked(lockByClean: boolean = false): Promise<void> {
        throwShouldBeOverridden();
    }

    $$markRemoteUnlocked(): Promise<void> {
        throwShouldBeOverridden();
    }

    $$markRemoteResolved(): Promise<void> {
        throwShouldBeOverridden();
    }

    // <-- Remote Governing

    $$isFileSizeExceeded(size: number): boolean {
        throwShouldBeOverridden();
    }

    $$performFullScan(showingNotice?: boolean): Promise<void> {
        throwShouldBeOverridden();
    }

    $anyResolveConflictByUI(
        filename: FilePathWithPrefix,
        conflictCheckResult: diff_result
    ): Promise<boolean | undefined> {
        return InterceptiveAny;
    }
    $$resolveConflictByDeletingRev(
        path: FilePathWithPrefix,
        deleteRevision: string,
        subTitle = ""
    ): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED> {
        throwShouldBeOverridden();
    }
    $$resolveConflict(filename: FilePathWithPrefix): Promise<void> {
        throwShouldBeOverridden();
    }
    $anyResolveConflictByNewest(filename: FilePathWithPrefix): Promise<boolean> {
        throwShouldBeOverridden();
    }

    $$resetLocalDatabase(): Promise<void> {
        throwShouldBeOverridden();
    }

    $$tryResetRemoteDatabase(): Promise<void> {
        throwShouldBeOverridden();
    }

    $$tryCreateRemoteDatabase(): Promise<void> {
        throwShouldBeOverridden();
    }

    $$isIgnoredByIgnoreFiles(file: string | UXFileInfoStub): Promise<boolean> {
        throwShouldBeOverridden();
    }

    $$isTargetFile(file: string | UXFileInfoStub, keepFileCheckList = false): Promise<boolean> {
        throwShouldBeOverridden();
    }

    $$askReload(message?: string) {
        throwShouldBeOverridden();
    }
    $$scheduleAppReload() {
        throwShouldBeOverridden();
    }

    //--- Setup
    $allSuspendAllSync(): Promise<boolean> {
        return InterceptiveAll;
    }
    $allSuspendExtraSync(): Promise<boolean> {
        return InterceptiveAll;
    }

    $allAskUsingOptionalSyncFeature(opt: { enableFetch?: boolean; enableOverwrite?: boolean }): Promise<boolean> {
        throwShouldBeOverridden();
    }
    $anyConfigureOptionalSyncFeature(mode: string): Promise<void> {
        throwShouldBeOverridden();
    }

    $$showView(viewType: string): Promise<void> {
        throwShouldBeOverridden();
    }

    // For Development: Ensure reliability MORE AND MORE. May the this plug-in helps all of us.
    $everyModuleTest(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $everyModuleTestMultiDevice(): Promise<boolean> {
        return InterceptiveEvery;
    }
    $$addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void {
        throwShouldBeOverridden();
    }

    _isThisModuleEnabled(): boolean {
        return true;
    }

    $anyGetAppId(): Promise<string | undefined> {
        return InterceptiveAny;
    }

    // Plug-in's overrideable functions
    onload() {
        void this.$$onLiveSyncLoad();
    }
    async saveSettings() {
        await this.$$saveSettingData();
    }
    onunload() {
        return void this.$$onLiveSyncUnload();
    }
    // <-- Plug-in's overrideable functions
}

// For now,
export type LiveSyncCore = ObsidianLiveSyncPlugin;
