import { TAbstractFile, TFile, TFolder } from "../../../deps.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { shouldBeIgnored } from "../../../lib/src/string_and_binary/path.ts";
import {
    DEFAULT_SETTINGS,
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_VERBOSE,
    type FileEventType,
    type FilePath,
    type UXFileInfoStub,
    type UXInternalFileInfoStub,
} from "../../../lib/src/common/types.ts";
import { delay, fireAndForget, throttle } from "../../../lib/src/common/utils.ts";
import { type FileEventItem } from "../../../common/types.ts";
import { serialized, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { isWaitingForTimeout } from "octagonal-wheels/concurrency/task";
import { Semaphore } from "octagonal-wheels/concurrency/semaphore";
import type { LiveSyncCore } from "../../../main.ts";
import { InternalFileToUXFileInfoStub, TFileToUXFileInfoStub } from "./utilObsidian.ts";
import ObsidianLiveSyncPlugin from "../../../main.ts";
import type { StorageAccess } from "../../interfaces/StorageAccess.ts";
import { HiddenFileSync } from "../../../features/HiddenFileSync/CmdHiddenFileSync.ts";
import { promiseWithResolvers, type PromiseWithResolvers } from "octagonal-wheels/promises";
// import { InternalFileToUXFileInfo } from "../platforms/obsidian.ts";

export type FileEvent = {
    type: FileEventType;
    file: UXFileInfoStub | UXInternalFileInfoStub;
    oldPath?: string;
    cachedData?: string;
    skipBatchWait?: boolean;
    cancelled?: boolean;
};
type WaitInfo = {
    since: number;
    type: FileEventType;
    canProceed: PromiseWithResolvers<boolean>;
    timerHandler: ReturnType<typeof setTimeout>;
    event: FileEventItem;
};
const TYPE_SENTINEL_FLUSH = "SENTINEL_FLUSH";
type FileEventItemSentinelFlush = {
    type: typeof TYPE_SENTINEL_FLUSH;
};
type FileEventItemSentinel = FileEventItemSentinelFlush;

export abstract class StorageEventManager {
    abstract beginWatch(): Promise<void>;

    abstract appendQueue(items: FileEvent[], ctx?: any): Promise<void>;

    abstract isWaiting(filename: FilePath): boolean;
    abstract waitForIdle(): Promise<void>;
    abstract restoreState(): Promise<void>;
}

export class StorageEventManagerObsidian extends StorageEventManager {
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncCore;
    storageAccess: StorageAccess;
    get services() {
        return this.core.services;
    }

    get shouldBatchSave() {
        return this.core.settings?.batchSave && this.core.settings?.liveSync != true;
    }
    get batchSaveMinimumDelay(): number {
        return this.core.settings?.batchSaveMinimumDelay ?? DEFAULT_SETTINGS.batchSaveMinimumDelay;
    }
    get batchSaveMaximumDelay(): number {
        return this.core.settings?.batchSaveMaximumDelay ?? DEFAULT_SETTINGS.batchSaveMaximumDelay;
    }
    // Necessary evil.
    cmdHiddenFileSync: HiddenFileSync;

    /**
     * Snapshot restoration promise.
     * Snapshot will be restored before starting to watch vault changes.
     * In designed time, this has been called from Initialisation process, which has been implemented on `ModuleInitializerFile.ts`.
     */
    snapShotRestored: Promise<void> | null = null;

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, storageAccess: StorageAccess) {
        super();
        this.storageAccess = storageAccess;
        this.plugin = plugin;
        this.core = core;
        this.cmdHiddenFileSync = this.plugin.getAddOn(HiddenFileSync.name) as HiddenFileSync;
    }

    /**
     * Restore the previous snapshot if exists.
     * @returns
     */
    restoreState(): Promise<void> {
        this.snapShotRestored = this._restoreFromSnapshot();
        return this.snapShotRestored;
    }

    async beginWatch() {
        await this.snapShotRestored;
        const plugin = this.plugin;
        this.watchVaultChange = this.watchVaultChange.bind(this);
        this.watchVaultCreate = this.watchVaultCreate.bind(this);
        this.watchVaultDelete = this.watchVaultDelete.bind(this);
        this.watchVaultRename = this.watchVaultRename.bind(this);
        this.watchVaultRawEvents = this.watchVaultRawEvents.bind(this);
        this.watchEditorChange = this.watchEditorChange.bind(this);
        plugin.registerEvent(plugin.app.vault.on("modify", this.watchVaultChange));
        plugin.registerEvent(plugin.app.vault.on("delete", this.watchVaultDelete));
        plugin.registerEvent(plugin.app.vault.on("rename", this.watchVaultRename));
        plugin.registerEvent(plugin.app.vault.on("create", this.watchVaultCreate));
        //@ts-ignore : Internal API
        plugin.registerEvent(plugin.app.vault.on("raw", this.watchVaultRawEvents));
        plugin.registerEvent(plugin.app.workspace.on("editor-change", this.watchEditorChange));
    }
    watchEditorChange(editor: any, info: any) {
        if (!("path" in info)) {
            return;
        }
        if (!this.shouldBatchSave) {
            return;
        }
        const file = info?.file as TFile;
        if (!file) return;
        if (this.storageAccess.isFileProcessing(file.path as FilePath)) {
            // Logger(`Editor change skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        if (!this.isWaiting(file.path as FilePath)) {
            return;
        }
        const data = info?.data as string;
        const fi: FileEvent = {
            type: "CHANGED",
            file: TFileToUXFileInfoStub(file),
            cachedData: data,
        };
        void this.appendQueue([fi]);
    }

    watchVaultCreate(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        if (this.storageAccess.isFileProcessing(file.path as FilePath)) {
            // Logger(`File create skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        const fileInfo = TFileToUXFileInfoStub(file);
        void this.appendQueue([{ type: "CREATE", file: fileInfo }], ctx);
    }

    watchVaultChange(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        if (this.storageAccess.isFileProcessing(file.path as FilePath)) {
            // Logger(`File change skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        const fileInfo = TFileToUXFileInfoStub(file);
        void this.appendQueue([{ type: "CHANGED", file: fileInfo }], ctx);
    }

    watchVaultDelete(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        if (this.storageAccess.isFileProcessing(file.path as FilePath)) {
            // Logger(`File delete skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        const fileInfo = TFileToUXFileInfoStub(file, true);
        void this.appendQueue([{ type: "DELETE", file: fileInfo }], ctx);
    }
    watchVaultRename(file: TAbstractFile, oldFile: string, ctx?: any) {
        // vault Rename will not be raised for self-events (Self-hosted LiveSync will not handle 'rename').
        if (file instanceof TFile) {
            const fileInfo = TFileToUXFileInfoStub(file);
            void this.appendQueue(
                [
                    {
                        type: "DELETE",
                        file: {
                            path: oldFile as FilePath,
                            name: file.name,
                            stat: {
                                mtime: file.stat.mtime,
                                ctime: file.stat.ctime,
                                size: file.stat.size,
                                type: "file",
                            },
                            deleted: true,
                        },
                        skipBatchWait: true,
                    },
                    { type: "CREATE", file: fileInfo, skipBatchWait: true },
                ],
                ctx
            );
        }
    }
    // Watch raw events (Internal API)
    watchVaultRawEvents(path: FilePath) {
        if (this.storageAccess.isFileProcessing(path)) {
            // Logger(`Raw file event skipped because the file is being processed: ${path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        // Only for internal files.
        if (!this.plugin.settings) return;
        // if (this.plugin.settings.useIgnoreFiles && this.plugin.ignoreFiles.some(e => path.endsWith(e.trim()))) {
        if (this.plugin.settings.useIgnoreFiles) {
            // If it is one of ignore files, refresh the cached one.
            // (Calling$$isTargetFile will refresh the cache)
            void this.services.vault.isTargetFile(path).then(() => this._watchVaultRawEvents(path));
        } else {
            void this._watchVaultRawEvents(path);
        }
    }

    async _watchVaultRawEvents(path: FilePath) {
        if (!this.plugin.settings.syncInternalFiles && !this.plugin.settings.usePluginSync) return;
        if (!this.plugin.settings.watchInternalFileChanges) return;
        if (!path.startsWith(this.plugin.app.vault.configDir)) return;
        if (path.endsWith("/")) {
            // Folder
            return;
        }
        const isTargetFile = await this.cmdHiddenFileSync.isTargetFile(path);
        if (!isTargetFile) return;

        void this.appendQueue(
            [
                {
                    type: "INTERNAL",
                    file: InternalFileToUXFileInfoStub(path),
                    skipBatchWait: true, // Internal files should be processed immediately.
                },
            ],
            null
        );
    }

    // Cache file and waiting to can be proceed.
    async appendQueue(params: FileEvent[], ctx?: any) {
        if (!this.core.settings.isConfigured) return;
        if (this.core.settings.suspendFileWatching) return;
        if (this.core.settings.maxMTimeForReflectEvents > 0) {
            return;
        }
        this.core.services.vault.markFileListPossiblyChanged();
        // Flag up to be reload
        for (const param of params) {
            if (shouldBeIgnored(param.file.path)) {
                continue;
            }
            const atomicKey = [0, 0, 0, 0, 0, 0].map((e) => `${Math.floor(Math.random() * 100000)}`).join("-");
            const type = param.type;
            const file = param.file;
            const oldPath = param.oldPath;
            if (type !== "INTERNAL") {
                const size = (file as UXFileInfoStub).stat.size;
                if (this.services.vault.isFileSizeTooLarge(size) && (type == "CREATE" || type == "CHANGED")) {
                    Logger(
                        `The storage file has been changed but exceeds the maximum size. Skipping: ${param.file.path}`,
                        LOG_LEVEL_NOTICE
                    );
                    continue;
                }
            }
            if (file instanceof TFolder) continue;
            // TODO: Confirm why only the TFolder skipping
            // Possibly following line is needed...
            // if (file?.isFolder) continue;
            if (!(await this.services.vault.isTargetFile(file.path))) continue;

            // Stop cache using to prevent the corruption;
            // let cache: null | string | ArrayBuffer;
            // new file or something changed, cache the changes.
            // if (file instanceof TFile && (type == "CREATE" || type == "CHANGED")) {
            if (file instanceof TFile || !file.isFolder) {
                if (type == "CREATE" || type == "CHANGED") {
                    // Wait for a bit while to let the writer has marked `touched` at the file.
                    await delay(10);
                    if (this.core.storageAccess.recentlyTouched(file.path)) {
                        continue;
                    }
                }
            }

            let cache: string | undefined = undefined;
            if (param.cachedData) {
                cache = param.cachedData;
            }
            void this.enqueue({
                type,
                args: {
                    file: file,
                    oldPath,
                    cache,
                    ctx,
                },
                skipBatchWait: param.skipBatchWait,
                key: atomicKey,
            });
        }
    }
    private bufferedQueuedItems = [] as (FileEventItem | FileEventItemSentinel)[];

    /**
     * Immediately take snapshot.
     */
    private _triggerTakeSnapshot() {
        void this._takeSnapshot();
    }
    /**
     * Trigger taking snapshot after throttled period.
     */
    triggerTakeSnapshot = throttle(() => this._triggerTakeSnapshot(), 100);

    enqueue(newItem: FileEventItem) {
        if (newItem.type == "DELETE") {
            // If the sentinel pushed, the runQueuedEvents will wait for idle before processing delete.
            this.bufferedQueuedItems.push({
                type: TYPE_SENTINEL_FLUSH,
            });
        }
        this.updateStatus();
        this.bufferedQueuedItems.push(newItem);

        fireAndForget(() => this._takeSnapshot().then(() => this.runQueuedEvents()));
    }

    // Limit concurrent processing to reduce the IO load. file-processing + scheduler (1), so file events can be processed in 4 slots.
    concurrentProcessing = Semaphore(5);

    private _waitingMap = new Map<string, WaitInfo>();
    private _waitForIdle: Promise<void> | null = null;

    /**
     * Wait until all queued events are processed.
     * Subsequent new events will not be waited, but new events will not be added.
     * @returns
     */
    waitForIdle(): Promise<void> {
        if (this._waitingMap.size === 0) {
            return Promise.resolve();
        }
        if (this._waitForIdle) {
            return this._waitForIdle;
        }
        const promises = [...this._waitingMap.entries()].map(([key, waitInfo]) => {
            return new Promise<void>((resolve) => {
                waitInfo.canProceed.promise
                    .then(() => {
                        Logger(`Processing ${key}: Wait for idle completed`, LOG_LEVEL_DEBUG);
                        // No op
                    })
                    .catch((e) => {
                        Logger(`Processing ${key}: Wait for idle error`, LOG_LEVEL_INFO);
                        Logger(e, LOG_LEVEL_VERBOSE);
                        //no op
                    })
                    .finally(() => {
                        resolve();
                    });
                this._proceedWaiting(key);
            });
        });
        const waitPromise = Promise.all(promises).then(() => {
            this._waitForIdle = null;
            Logger(`All wait for idle completed`, LOG_LEVEL_VERBOSE);
        });
        this._waitForIdle = waitPromise;
        return waitPromise;
    }

    /**
     * Proceed waiting for the given key immediately.
     */
    private _proceedWaiting(key: string) {
        const waitInfo = this._waitingMap.get(key);
        if (waitInfo) {
            waitInfo.canProceed.resolve(true);
            clearTimeout(waitInfo.timerHandler);
            this._waitingMap.delete(key);
        }
        this.triggerTakeSnapshot();
    }
    /**
     * Cancel waiting for the given key.
     */
    private _cancelWaiting(key: string) {
        const waitInfo = this._waitingMap.get(key);
        if (waitInfo) {
            waitInfo.canProceed.resolve(false);
            clearTimeout(waitInfo.timerHandler);
            this._waitingMap.delete(key);
        }
        this.triggerTakeSnapshot();
    }
    /**
     * Add waiting for the given key.
     * @param key
     * @param event
     * @param waitedSince Optional waited since timestamp to calculate the remaining delay.
     */
    private _addWaiting(key: string, event: FileEventItem, waitedSince?: number): WaitInfo {
        if (this._waitingMap.has(key)) {
            // Already waiting
            throw new Error(`Already waiting for key: ${key}`);
        }
        const resolver = promiseWithResolvers<boolean>();
        const now = Date.now();
        const since = waitedSince ?? now;
        const elapsed = now - since;
        const maxDelay = this.batchSaveMaximumDelay * 1000;
        const remainingDelay = Math.max(0, maxDelay - elapsed);
        const nextDelay = Math.min(remainingDelay, this.batchSaveMinimumDelay * 1000);
        // x*<------- maxDelay --------->*
        // x*<-- minDelay -->*
        // x*       x<-- nextDelay -->*
        // x*              x<-- Capped-->*
        // x*                    x.......*
        // x: event
        // *: save
        // When at event (x) At least, save (*) within maxDelay, but maintain minimum delay between saves.

        if (elapsed >= maxDelay) {
            // Already exceeded maximum delay, do not wait.
            Logger(`Processing ${key}: Batch save maximum delay already exceeded: ${event.type}`, LOG_LEVEL_DEBUG);
        } else {
            Logger(`Processing ${key}: Adding waiting for batch save: ${event.type} (${nextDelay}ms)`, LOG_LEVEL_DEBUG);
        }
        const waitInfo: WaitInfo = {
            since: since,
            type: event.type,
            event: event,
            canProceed: resolver,
            timerHandler: setTimeout(() => {
                Logger(`Processing ${key}: Batch save timeout reached: ${event.type}`, LOG_LEVEL_DEBUG);
                this._proceedWaiting(key);
            }, nextDelay),
        };
        this._waitingMap.set(key, waitInfo);
        this.triggerTakeSnapshot();
        return waitInfo;
    }

    /**
     * Process the given file event.
     */
    async processFileEvent(fei: FileEventItem) {
        const releaser = await this.concurrentProcessing.acquire();
        try {
            this.updateStatus();
            const filename = fei.args.file.path;
            const waitingKey = `${filename}`;
            const previous = this._waitingMap.get(waitingKey);
            let isShouldBeCancelled = fei.skipBatchWait || false;
            let previousPromise: Promise<boolean> = Promise.resolve(true);
            let waitPromise: Promise<boolean> = Promise.resolve(true);
            // 1. Check if there is previous waiting for the same file
            if (previous) {
                previousPromise = previous.canProceed.promise;
                if (isShouldBeCancelled) {
                    Logger(
                        `Processing ${filename}: Requested to perform immediately, cancelling previous waiting: ${fei.type}`,
                        LOG_LEVEL_DEBUG
                    );
                }
                if (!isShouldBeCancelled && fei.type === "DELETE") {
                    // For DELETE, cancel any previous waiting and proceed immediately
                    // That because when deleting, we cannot read the file anymore.
                    Logger(
                        `Processing ${filename}: DELETE requested, cancelling previous waiting: ${fei.type}`,
                        LOG_LEVEL_DEBUG
                    );
                    isShouldBeCancelled = true;
                }
                if (!isShouldBeCancelled && previous.type === fei.type) {
                    // For the same type, we can cancel the previous waiting and proceed immediately.
                    Logger(`Processing ${filename}: Cancelling previous waiting: ${fei.type}`, LOG_LEVEL_DEBUG);
                    isShouldBeCancelled = true;
                }
                // 2. wait for the previous to complete
                if (isShouldBeCancelled) {
                    this._cancelWaiting(waitingKey);
                    Logger(`Processing ${filename}: Previous cancelled: ${fei.type}`, LOG_LEVEL_DEBUG);
                    isShouldBeCancelled = true;
                }
                if (!isShouldBeCancelled) {
                    Logger(`Processing ${filename}: Waiting for previous to complete: ${fei.type}`, LOG_LEVEL_DEBUG);
                    this._proceedWaiting(waitingKey);
                    Logger(`Processing ${filename}: Previous completed: ${fei.type}`, LOG_LEVEL_DEBUG);
                }
            }
            await previousPromise;
            // 3. Check if shouldBatchSave is true
            if (this.shouldBatchSave && !fei.skipBatchWait) {
                // if type is CREATE or CHANGED, set waiting
                if (fei.type == "CREATE" || fei.type == "CHANGED") {
                    // 3.2. If true, set the queue, and wait for the waiting, or until timeout
                    // (since is copied from previous waiting if exists to limit the maximum wait time)
                    // console.warn(`Since:`, previous?.since);
                    const info = this._addWaiting(waitingKey, fei, previous?.since);
                    waitPromise = info.canProceed.promise;
                } else if (fei.type == "DELETE") {
                    // For DELETE, cancel any previous waiting and proceed immediately
                }
                Logger(`Processing ${filename}: Waiting for batch save: ${fei.type}`, LOG_LEVEL_DEBUG);
                const canProceed = await waitPromise;
                if (!canProceed) {
                    // 3.2.1. If cancelled by new queue, cancel subsequent process.
                    Logger(`Processing ${filename}: Cancelled by new queue: ${fei.type}`, LOG_LEVEL_DEBUG);
                    return;
                }
            }
            // await this.handleFileEvent(fei);
            await this.requestProcessQueue(fei);
        } finally {
            await this._takeSnapshot();
            releaser();
        }
    }
    async _takeSnapshot() {
        const processingEvents = [...this._waitingMap.values()].map((e) => e.event);
        const waitingEvents = this.bufferedQueuedItems;
        const snapShot = [...processingEvents, ...waitingEvents];
        await this.core.kvDB.set("storage-event-manager-snapshot", snapShot);
        Logger(`Storage operation snapshot taken: ${snapShot.length} items`, LOG_LEVEL_DEBUG);
        this.updateStatus();
    }
    async _restoreFromSnapshot() {
        const snapShot = await this.core.kvDB.get<(FileEventItem | FileEventItemSentinel)[]>(
            "storage-event-manager-snapshot"
        );
        if (snapShot && Array.isArray(snapShot) && snapShot.length > 0) {
            // console.warn(`Restoring snapshot: ${snapShot.length} items`);
            Logger(`Restoring storage operation snapshot: ${snapShot.length} items`, LOG_LEVEL_VERBOSE);
            // Restore the snapshot
            // Note: Mark all items as skipBatchWait to prevent apply the off-line batch saving.
            this.bufferedQueuedItems = snapShot.map((e) => ({ ...e, skipBatchWait: true }));
            this.updateStatus();
            await this.runQueuedEvents();
        } else {
            Logger(`No snapshot to restore`, LOG_LEVEL_VERBOSE);
            // console.warn(`No snapshot to restore`);
        }
    }
    runQueuedEvents() {
        return skipIfDuplicated("storage-event-manager-run-queued-events", async () => {
            do {
                if (this.bufferedQueuedItems.length === 0) {
                    break;
                }
                // 1. Get the first queued item

                const fei = this.bufferedQueuedItems.shift()!;
                await this._takeSnapshot();
                this.updateStatus();
                // 2. Consume 1 semaphore slot to enqueue processing. Then release immediately.
                // (Just to limit the total concurrent processing count, because skipping batch handles at processFileEvent).
                const releaser = await this.concurrentProcessing.acquire();
                releaser();
                this.updateStatus();
                // 3. Check if sentinel flush
                //    If sentinel, wait for idle and continue.
                if (fei.type === TYPE_SENTINEL_FLUSH) {
                    Logger(`Waiting for idle`, LOG_LEVEL_VERBOSE);
                    // Flush all waiting batch queues
                    await this.waitForIdle();
                    this.updateStatus();
                    continue;
                }
                // 4. Process the event, this should be fire-and-forget to not block the queue processing in each file.
                fireAndForget(() => this.processFileEvent(fei));
            } while (this.bufferedQueuedItems.length > 0);
        });
    }

    processingCount = 0;
    async requestProcessQueue(fei: FileEventItem) {
        try {
            this.processingCount++;
            // this.bufferedQueuedItems.remove(fei);
            this.updateStatus();
            // this.waitedSince.delete(fei.args.file.path);
            await this.handleFileEvent(fei);
            await this._takeSnapshot();
        } finally {
            this.processingCount--;
            this.updateStatus();
        }
    }
    isWaiting(filename: FilePath) {
        return isWaitingForTimeout(`storage-event-manager-batchsave-${filename}`);
    }

    updateStatus() {
        const allFileEventItems = this.bufferedQueuedItems.filter((e): e is FileEventItem => "args" in e);
        const allItems = allFileEventItems.filter((e) => !e.cancelled);
        const totalItems = allItems.length + this.concurrentProcessing.waiting;
        const processing = this.processingCount;
        const batchedCount = this._waitingMap.size;
        this.core.batched.value = batchedCount;
        this.core.processing.value = processing;
        this.core.totalQueued.value = totalItems + batchedCount + processing;
    }

    async handleFileEvent(queue: FileEventItem): Promise<any> {
        const file = queue.args.file;
        const lockKey = `handleFile:${file.path}`;
        const ret = await serialized(lockKey, async () => {
            if (queue.cancelled) {
                Logger(`File event cancelled before processing: ${file.path}`, LOG_LEVEL_INFO);
                return;
            }
            if (queue.type == "INTERNAL" || file.isInternal) {
                await this.core.services.fileProcessing.processOptionalFileEvent(file.path as unknown as FilePath);
            } else {
                const key = `file-last-proc-${queue.type}-${file.path}`;
                const last = Number((await this.core.kvDB.get(key)) || 0);
                if (queue.type == "DELETE") {
                    await this.core.services.fileProcessing.processFileEvent(queue);
                } else {
                    if (file.stat.mtime == last) {
                        Logger(`File has been already scanned on ${queue.type}, skip: ${file.path}`, LOG_LEVEL_VERBOSE);
                        // Should Cancel the relative operations? (e.g. rename)
                        // this.cancelRelativeEvent(queue);
                        return;
                    }
                    if (!(await this.core.services.fileProcessing.processFileEvent(queue))) {
                        Logger(
                            `STORAGE -> DB: Handler failed, cancel the relative operations: ${file.path}`,
                            LOG_LEVEL_INFO
                        );
                        // cancel running queues and remove one of atomic operation (e.g. rename)
                        this.cancelRelativeEvent(queue);
                        return;
                    }
                }
            }
        });
        this.updateStatus();
        return ret;
    }

    cancelRelativeEvent(item: FileEventItem): void {
        this._cancelWaiting(item.args.file.path);
    }
}
