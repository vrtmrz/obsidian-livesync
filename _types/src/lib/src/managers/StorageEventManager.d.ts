// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type FileEventType, type FilePath, type UXFileInfoStub, type UXFolderInfo, type UXInternalFileInfoStub } from "@lib/common/types.ts";
import { type FileEventItem } from "@lib/common/types.ts";
import type { IStorageAccessManager } from "@lib/interfaces/StorageAccess.ts";
import { type PromiseWithResolvers } from "octagonal-wheels/promises";
import { StorageEventManager, type FileEvent } from "@lib/interfaces/StorageEventManager.ts";
import type { IAPIService, IVaultService } from "@lib/services/base/IService.ts";
import type { SettingService } from "@lib/services/base/SettingService.ts";
import type { FileProcessingService } from "@lib/services/base/FileProcessingService.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
import type { IStorageEventManagerAdapter } from "./adapters";
import { type CompatTimeoutHandle } from "@lib/common/coreEnvFunctions";
type WaitInfo = {
    since: number;
    type: FileEventType;
    canProceed: PromiseWithResolvers<boolean>;
    timerHandler: CompatTimeoutHandle;
    event: FileEventItem;
};
declare const TYPE_SENTINEL_FLUSH = "SENTINEL_FLUSH";
type FileEventItemSentinelFlush = {
    type: typeof TYPE_SENTINEL_FLUSH;
};
export type FileEventItemSentinel = FileEventItemSentinelFlush;
export interface StorageEventManagerBaseDependencies {
    setting: SettingService;
    vaultService: IVaultService;
    fileProcessing: FileProcessingService;
    storageAccessManager: IStorageAccessManager;
    APIService: IAPIService;
}
/**
 * Type helper to extract the file type from a storage event manager adapter
 */
export type ExtractFile<T> = T extends IStorageEventManagerAdapter<infer F, any> ? F : never; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Type helper to extract the folder type from a storage event manager adapter
 */
export type ExtractFolder<T> = T extends IStorageEventManagerAdapter<any, infer D> ? D : never; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Base class for storage event management
 * Uses adapter pattern for platform-specific implementations
 *
 * @template TAdapter - The storage event manager adapter type
 */
export declare abstract class StorageEventManagerBase<TAdapter extends IStorageEventManagerAdapter<any, any>> extends StorageEventManager { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    _log: ReturnType<typeof createInstanceLogFunction>;
    protected setting: SettingService;
    protected vaultService: IVaultService;
    protected fileProcessing: FileProcessingService;
    protected storageAccess: IStorageAccessManager;
    protected adapter: TAdapter;
    protected get shouldBatchSave(): boolean;
    protected get batchSaveMinimumDelay(): number;
    protected get batchSaveMaximumDelay(): number;
    get settings(): import("@lib/common/types.ts").ObsidianLiveSyncSettings;
    constructor(adapter: TAdapter, dependencies: StorageEventManagerBaseDependencies);
    _saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]): Promise<void>;
    _loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null>;
    isFolder(file: UXFileInfoStub | UXInternalFileInfoStub | UXFolderInfo | ExtractFolder<TAdapter> | ExtractFile<TAdapter>): boolean;
    isFile(file: UXFileInfoStub | UXInternalFileInfoStub | UXFolderInfo | ExtractFolder<TAdapter> | ExtractFile<TAdapter>): boolean;
    protected updateStatus(): void;
    /**
     * Snapshot restoration promise.
     * Snapshot will be restored before starting to watch vault changes.
     * In designed time, this has been called from Initialisation process, which has been implemented on `ModuleInitializerFile.ts`.
     */
    snapShotRestored: Promise<void> | null;
    /**
     * Restore the previous snapshot if exists.
     * @returns
     */
    restoreState(): Promise<void>;
    appendQueue(params: FileEvent[], ctx?: unknown): Promise<void>;
    protected bufferedQueuedItems: (FileEventItem | FileEventItemSentinel)[];
    enqueue(newItem: FileEventItem): void;
    /**
     * Immediately take snapshot.
     */
    private _triggerTakeSnapshot;
    /**
     * Trigger taking snapshot after throttled period.
     */
    triggerTakeSnapshot: import("octagonal-wheels/function").ThrottledFunction<() => void>;
    protected concurrentProcessing: import("octagonal-wheels/concurrency/semaphore_v2").SemaphoreObject;
    protected _waitingMap: Map<string, WaitInfo>;
    private _waitForIdle;
    /**
     * Wait until all queued events are processed.
     * Subsequent new events will not be waited, but new events will not be added.
     * @returns
     */
    waitForIdle(): Promise<void>;
    /**
     * Proceed waiting for the given key immediately.
     */
    private _proceedWaiting;
    /**
     * Cancel waiting for the given key.
     */
    private _cancelWaiting;
    /**
     * Add waiting for the given key.
     * @param key
     * @param event
     * @param waitedSince Optional waited since timestamp to calculate the remaining delay.
     */
    private _addWaiting;
    /**
     * Process the given file event.
     */
    processFileEvent(fei: FileEventItem): Promise<void>;
    _takeSnapshot(): Promise<void>;
    _restoreFromSnapshot(): Promise<void>;
    protected runQueuedEvents(): Promise<void | null>;
    protected processingCount: number;
    protected requestProcessQueue(fei: FileEventItem): Promise<void>;
    isWaiting(filename: FilePath): boolean;
    protected handleFileEvent(queue: FileEventItem): Promise<void>;
    protected cancelRelativeEvent(item: FileEventItem): void;
    /**
     * Begin watching for storage events
     */
    beginWatch(): Promise<void>;
    /**
     * Platform-agnostic event handlers
     */
    protected watchEditorChange<TEditor = unknown, TInfo = unknown>(editor: TEditor, info: TInfo): void;
    protected watchVaultCreate<TFile = unknown, TCtx = unknown>(file: TFile, ctx?: TCtx): void;
    protected watchVaultChange<TFile = unknown, TCtx = unknown>(file: TFile, ctx?: TCtx): void;
    protected watchVaultDelete<TFile = unknown, TCtx = unknown>(file: TFile, ctx?: TCtx): void;
    protected watchVaultRename<TFile = unknown, TCtx = unknown>(file: TFile, oldPath: string, ctx?: TCtx): void;
    protected watchVaultRawEvents(path: FilePath): void;
    protected _watchVaultRawEvents(path: FilePath): Promise<void>;
}
export {};
