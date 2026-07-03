// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FetchHttpHandler } from "@smithy/fetch-http-handler";
import { type LOG_LEVEL } from "octagonal-wheels/common/logger";
import type { AnyEntry, AUTO_MERGED, CouchDBCredentials, diff_result, DocumentID, EntryDoc, EntryHasPath, FileEventItem, FilePath, FilePathWithPrefix, LoadedEntry, MetaEntry, MISSING_OR_ERROR, ObsidianLiveSyncSettings, RemoteDBSettings, TweakValues, UXFileInfo, UXFileInfoStub } from "@lib/common/types";
import type { LiveSyncLocalDB } from "@lib/pouchdb/LiveSyncLocalDB";
import type { LiveSyncAbstractReplicator } from "@lib/replication/LiveSyncAbstractReplicator";
import type { SimpleStore } from "octagonal-wheels/databases/SimpleStoreBase";
import type { Confirm } from "@lib/interfaces/Confirm";
import type { ReactiveSource } from "octagonal-wheels/dataobject/reactive";
import type { ReplicationStatics } from "@lib/common/models/shared.definition";
import type { ReplicatorService } from "./ReplicatorService";
import type { DatabaseEventService } from "./DatabaseEventService";
import type { BASE_IS_NEW, EVEN, TARGET_IS_NEW } from "@lib/common/models/shared.const.symbols";
declare global {
    interface OPTIONAL_SYNC_FEATURES {
        DISABLE: "DISABLE";
    }
}
export interface ICommandCompat {
    id: string;
    name: string;
    icon?: string;
    callback?: () => any; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    checkCallback?: (checking: boolean) => boolean | void;
    editorCallback?: (editor: any, ctx: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    editorCheckCallback?: (checking: any, editor: any, ctx: any) => boolean | void; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
}
export interface IAPIService {
    getCustomFetchHandler(): FetchHttpHandler;
    addStatusBarItem(): HTMLElement | undefined;
    addLog(message: unknown, level: LOG_LEVEL, key?: string): void;
    isMobile(): boolean;
    showWindow(type: string): Promise<void>;
    showWindowOnRight?(type: string): Promise<void>;
    getAppID(): string;
    getSystemVaultName(): string;
    getPlatform(): string;
    getAppVersion(): string;
    getPluginVersion(): string;
    addCommand<TCommand extends ICommandCompat>(command: TCommand): TCommand;
    registerWindow<T>(type: string, factory: (leaf: T) => unknown): void;
    addRibbonIcon(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement;
    registerProtocolHandler(action: string, handler: (params: Record<string, string>) => unknown): void;
    confirm: Confirm;
    responseCount: ReactiveSource<number>;
    requestCount: ReactiveSource<number>;
    isOnline: boolean;
    webCompatFetch(url: string | Request, opts?: RequestInit): Promise<Response>;
    nativeFetch(url: string | Request, opts?: RequestInit): Promise<Response>;
    setInterval(handler: () => void, timeout: number): number;
    clearInterval(timerId: number): void;
    getSystemConfigDir(): string;
}
export interface IPathService {
    id2path(id: DocumentID, entry?: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix;
    path2id(filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID>;
    getPath(entry: AnyEntry): FilePathWithPrefix;
    markChangesAreSame(old: UXFileInfo | AnyEntry | FilePathWithPrefix, newMtime: number, oldMtime: number): boolean | undefined;
    unmarkChanges(file: AnyEntry | FilePathWithPrefix | UXFileInfoStub): void;
    compareFileFreshness(baseFile: UXFileInfoStub | AnyEntry | undefined, checkTarget: UXFileInfo | AnyEntry | undefined): typeof BASE_IS_NEW | typeof TARGET_IS_NEW | typeof EVEN;
    isMarkedAsSameChanges(file: UXFileInfoStub | AnyEntry | FilePathWithPrefix, mtimes: number[]): undefined | typeof EVEN;
}
export interface openDatabaseParameters {
    replicator: ReplicatorService;
    databaseEvents: DatabaseEventService;
}
export interface IDatabaseService {
    localDatabase: LiveSyncLocalDB;
    createPouchDBInstance<T extends object>(name?: string, options?: PouchDB.Configuration.DatabaseConfiguration): PouchDB.Database<T>;
    openDatabase(params: openDatabaseParameters): Promise<boolean>;
    resetDatabase(): Promise<boolean>;
    onDatabaseReset: () => Promise<boolean>;
    onOpenDatabase: (vaultName: string) => Promise<boolean>;
    isDatabaseReady(): boolean;
}
export interface IDatabaseEventService {
    onUnloadDatabase(db: LiveSyncLocalDB): Promise<boolean>;
    onCloseDatabase(db: LiveSyncLocalDB): Promise<boolean>;
    onDatabaseInitialisation(db: LiveSyncLocalDB): Promise<boolean>;
    onDatabaseInitialised(showNotice: boolean): Promise<boolean>;
    onDatabaseHasReady(): Promise<boolean>;
    onResetDatabase(db: LiveSyncLocalDB): Promise<boolean>;
    initialiseDatabase(showingNotice?: boolean, reopenDatabase?: boolean, ignoreSuspending?: boolean): Promise<boolean>;
}
export interface IKeyValueDBService {
    openSimpleStore<T>(kind: string): SimpleStore<T>;
    simpleStore: SimpleStore<unknown>;
}
export interface IFileProcessingService {
    processFileEvent(item: FileEventItem): Promise<boolean>;
    processOptionalFileEvent(path: FilePath): Promise<boolean>;
    commitPendingFileEvents(): Promise<boolean>;
    batched: ReactiveSource<number>;
    processing: ReactiveSource<number>;
    totalQueued: ReactiveSource<number>;
    totalStorageFileEventCount: number;
    onStorageFileEvent(): void;
}
export interface IReplicatorService {
    onCloseActiveReplication(): Promise<boolean>;
    onReplicatorInitialised(): Promise<boolean>;
    getNewReplicator(settingOverride?: Partial<ObsidianLiveSyncSettings>): Promise<LiveSyncAbstractReplicator | undefined | false>;
    getActiveReplicator(): LiveSyncAbstractReplicator | undefined;
    replicationStatics: ReactiveSource<ReplicationStatics>;
}
export interface IReplicationService {
    processSynchroniseResult(doc: MetaEntry): Promise<boolean>;
    processOptionalSynchroniseResult(doc: LoadedEntry): Promise<boolean>;
    processVirtualDocument(docs: PouchDB.Core.ExistingDocument<EntryDoc>): Promise<boolean>;
    onBeforeReplicate(showMessage: boolean): Promise<boolean>;
    checkConnectionFailure(): Promise<boolean | "CHECKAGAIN" | undefined>;
    onCheckReplicationReady(showMessage: boolean): Promise<boolean>;
    isReplicationReady(showMessage: boolean): Promise<boolean>;
    performReplication(showMessage?: boolean): Promise<boolean | void>;
    replicate(showMessage?: boolean): Promise<boolean | void>;
    replicateByEvent(showMessage?: boolean): Promise<boolean | void>;
    onReplicationFailed(showMessage?: boolean): Promise<boolean>;
    parseSynchroniseResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<boolean>;
    databaseQueueCount: ReactiveSource<number>;
    storageApplyingCount: ReactiveSource<number>;
    replicationResultCount: ReactiveSource<number>;
    replicateAllToRemote(showingNotice?: boolean, sendChunksInBulkDisabled?: boolean): Promise<boolean>;
    replicateAllFromRemote(showingNotice?: boolean): Promise<boolean>;
    markLocked(lockByClean?: boolean): Promise<void>;
    markUnlocked(): Promise<void>;
    markResolved(): Promise<void>;
}
export interface IRemoteService {
    connect(uri: string, auth: CouchDBCredentials, disableRequestURI: boolean, passphrase: string | false, useDynamicIterationCount: boolean, performSetup: boolean, skipInfo: boolean, compression: boolean, customHeaders: Record<string, string>, useRequestAPI: boolean, getPBKDF2Salt: () => Promise<Uint8Array>): Promise<string | {
        db: PouchDB.Database<EntryDoc>;
        info: PouchDB.Core.DatabaseInfo;
    }>;
    /**
     * State if the last POST request failed due to payload size.
     */
    get hadLastPostFailedBySize(): boolean;
}
export interface IConflictService {
    getOptionalConflictCheckMethod(path: FilePathWithPrefix): Promise<boolean | undefined | "newer">;
    resolveByUserInteraction: (filename: FilePathWithPrefix, conflictCheckResult: diff_result) => Promise<boolean | undefined>;
    queueCheckForIfOpen(path: FilePathWithPrefix): Promise<void>;
    queueCheckFor(path: FilePathWithPrefix): Promise<void>;
    ensureAllProcessed(): Promise<boolean>;
    resolveByDeletingRevision(path: FilePathWithPrefix, deleteRevision: string, title: string): Promise<typeof MISSING_OR_ERROR | typeof AUTO_MERGED>;
    resolve(filename: FilePathWithPrefix): Promise<void>;
    resolveByNewest(filename: FilePathWithPrefix): Promise<boolean>;
    resolveAllConflictedFilesByNewerOnes(): Promise<void>;
    conflictProcessQueueCount: ReactiveSource<number>;
}
export interface IAppLifecycleService {
    onLayoutReady(): Promise<boolean>;
    onFirstInitialise(): Promise<boolean>;
    onReady(): Promise<boolean>;
    onWireUpEvents(): Promise<boolean>;
    onInitialise(): Promise<boolean>;
    onLoad(): Promise<boolean>;
    onSettingLoaded(): Promise<boolean>;
    onLoaded(): Promise<boolean>;
    onScanningStartupIssues(): Promise<boolean>;
    onAppUnload(): Promise<undefined[]>;
    onBeforeUnload(): Promise<boolean>;
    onUnload(): Promise<boolean>;
    onSuspending(): Promise<boolean>;
    onResuming(): Promise<boolean>;
    onResumed(): Promise<boolean>;
    getUnresolvedMessages: () => Promise<(string | Error)[][]>;
    performRestart(): void;
    askRestart(message?: string): void;
    scheduleRestart(): void;
    isSuspended(): boolean;
    setSuspended(suspend: boolean): void;
    isReady(): boolean;
    markIsReady(): void;
    resetIsReady(): void;
    isReloadingScheduled(): boolean;
}
export interface ISettingService {
    onBeforeRealiseSetting(): Promise<boolean>;
    onSettingRealised(): Promise<boolean>;
    onRealiseSetting(): Promise<boolean>;
    suspendAllSync(): Promise<boolean>;
    suspendExtraSync(): Promise<boolean>;
    suggestOptionalFeatures(opt: {
        enableFetch?: boolean;
        enableOverwrite?: boolean;
    }): Promise<boolean>;
    enableOptionalFeature(mode: keyof OPTIONAL_SYNC_FEATURES): Promise<boolean>;
    clearUsedPassphrase(): void;
    decryptSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings>;
    adjustSettings(settings: ObsidianLiveSyncSettings): Promise<ObsidianLiveSyncSettings>;
    loadSettings(): Promise<void>;
    getDeviceAndVaultName(): string;
    setDeviceAndVaultName(name: string): void;
    saveDeviceAndVaultName(): void;
    onBeforeSaveSettingData(nextSettings: ObsidianLiveSyncSettings, previousSettings: ObsidianLiveSyncSettings): Promise<(Partial<ObsidianLiveSyncSettings> | void)[]>;
    saveSettingData(): Promise<void>;
    currentSettings(): ObsidianLiveSyncSettings;
    updateSettings(updateFn: (current: ObsidianLiveSyncSettings) => ObsidianLiveSyncSettings, saveImmediately?: boolean): Promise<void>;
    applyExternalSettings(partial: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean): Promise<void>;
    applyPartial(partial: Partial<ObsidianLiveSyncSettings>, saveImmediately?: boolean): Promise<void>;
    onSettingLoaded(settings: ObsidianLiveSyncSettings): Promise<boolean>;
    onSettingChanged(settings: ObsidianLiveSyncSettings): Promise<boolean>;
    onSettingSaved(settings: ObsidianLiveSyncSettings): Promise<boolean>;
    getSmallConfig(key: string): string | null;
    setSmallConfig(key: string, value: string): void;
    deleteSmallConfig(key: string): void;
}
export interface ITweakValueService {
    fetchRemotePreferred(trialSetting: RemoteDBSettings): Promise<TweakValues | false>;
    checkAndAskResolvingMismatched(preferred: Partial<TweakValues>): Promise<[TweakValues | boolean, boolean]>;
    askResolvingMismatched(preferredSource: TweakValues): Promise<"OK" | "CHECKAGAIN" | "IGNORE">;
    checkAndAskUseRemoteConfiguration(settings: RemoteDBSettings): Promise<{
        result: false | TweakValues;
        requireFetch: boolean;
    }>;
    askUseRemoteConfiguration(trialSetting: RemoteDBSettings, preferred: TweakValues): Promise<{
        result: false | TweakValues;
        requireFetch: boolean;
    }>;
}
export interface IVaultService {
    vaultName(): string;
    getVaultName(): string;
    scanVault(showingNotice?: boolean, ignoreSuspending?: boolean): Promise<boolean>;
    isIgnoredByIgnoreFile(file: string | UXFileInfoStub): Promise<boolean>;
    isTargetFile(file: string | UXFileInfoStub): Promise<boolean>;
    isTargetFileInExtra(file: string | UXFileInfoStub): Promise<boolean>;
    isFileSizeTooLarge(size: number): boolean;
    getActiveFilePath(): FilePath | undefined;
    isStorageInsensitive(): boolean;
    shouldCheckCaseInsensitively(): boolean;
    isValidPath(path: string): boolean;
}
export interface ITestService {
    test(): Promise<boolean>;
    testMultiDevice(): Promise<boolean>;
    addTestResult(name: string, key: string, result: boolean, summary?: string, message?: string): void;
}
export interface IUIService {
    promptCopyToClipboard(title: string, value: string): Promise<boolean>;
    showMarkdownDialog<T extends string[]>(title: string, contentMD: string, buttons: T): Promise<(typeof buttons)[number] | false>;
    get confirm(): Confirm;
}
export interface IConfigService {
    getSmallConfig(key: string): string | null;
    setSmallConfig(key: string, value: string): void;
    deleteSmallConfig(key: string): void;
}
export interface IServiceHub {
    API: IAPIService;
    path: IPathService;
    database: IDatabaseService;
    databaseEvents: IDatabaseEventService;
    replicator: IReplicatorService;
    fileProcessing: IFileProcessingService;
    replication: IReplicationService;
    remote: IRemoteService;
    conflict: IConflictService;
    appLifecycle: IAppLifecycleService;
    setting: ISettingService;
    tweakValue: ITweakValueService;
    vault: IVaultService;
    test: ITestService;
    UI: IUIService;
    config: IConfigService;
    keyValueDB: IKeyValueDBService;
    control: IControlService;
}
export interface IControlService {
    applySettings(): Promise<void>;
    onLoad(): Promise<boolean>;
    onReady(): Promise<boolean>;
    onUnload(): Promise<void>;
    hasUnloaded(): boolean;
    activated: Promise<boolean>;
}
