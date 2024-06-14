import type { SerializedFileAccess } from "./SerializedFileAccess.ts";
import { Plugin, TAbstractFile, TFile, TFolder } from "../deps.ts";
import { Logger } from "../lib/src/common/logger.ts";
import { shouldBeIgnored } from "../lib/src/string_and_binary/path.ts";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, type FilePath, type ObsidianLiveSyncSettings } from "../lib/src/common/types.ts";
import { delay, fireAndForget } from "../lib/src/common/utils.ts";
import { type FileEventItem, type FileEventType, type FileInfo, type InternalFileInfo } from "../common/types.ts";
import { skipIfDuplicated } from "../lib/src/concurrency/lock.ts";
import { finishAllWaitingForTimeout, finishWaitingForTimeout, isWaitingForTimeout, waitForTimeout } from "../lib/src/concurrency/task.ts";
import { reactiveSource, type ReactiveSource } from "../lib/src/dataobject/reactive.ts";
import { Semaphore } from "../lib/src/concurrency/semaphore.ts";


export type FileEvent = {
    type: FileEventType;
    file: TAbstractFile | InternalFileInfo;
    oldPath?: string;
    cachedData?: string;
    skipBatchWait?: boolean;
};


export abstract class StorageEventManager {
    abstract beginWatch(): void;
    abstract flushQueue(): void;
    abstract appendQueue(items: FileEvent[], ctx?: any): void;
    abstract cancelQueue(key: string): void;
    abstract isWaiting(filename: FilePath): boolean;
    abstract totalQueued: ReactiveSource<number>;
    abstract batched: ReactiveSource<number>;
    abstract processing: ReactiveSource<number>;

}

type LiveSyncForStorageEventManager = Plugin &
{
    settings: ObsidianLiveSyncSettings
    ignoreFiles: string[],
    vaultAccess: SerializedFileAccess
    shouldBatchSave: boolean
    batchSaveMinimumDelay: number;
    batchSaveMaximumDelay: number;

} & {
    isTargetFile: (file: string | TAbstractFile) => Promise<boolean>,
    // fileEventQueue: QueueProcessor<FileEventItem, any>,
    handleFileEvent: (queue: FileEventItem) => Promise<any>,
    isFileSizeExceeded: (size: number) => boolean;
};


export class StorageEventManagerObsidian extends StorageEventManager {
    totalQueued = reactiveSource(0);
    batched = reactiveSource(0);
    processing = reactiveSource(0);
    plugin: LiveSyncForStorageEventManager;

    get shouldBatchSave() {
        return this.plugin.shouldBatchSave;
    }
    get batchSaveMinimumDelay(): number {
        return this.plugin.batchSaveMinimumDelay;
    }
    get batchSaveMaximumDelay(): number {
        return this.plugin.batchSaveMaximumDelay
    }
    constructor(plugin: LiveSyncForStorageEventManager) {
        super();
        this.plugin = plugin;
    }
    beginWatch() {
        const plugin = this.plugin;
        this.watchVaultChange = this.watchVaultChange.bind(this);
        this.watchVaultCreate = this.watchVaultCreate.bind(this);
        this.watchVaultDelete = this.watchVaultDelete.bind(this);
        this.watchVaultRename = this.watchVaultRename.bind(this);
        this.watchVaultRawEvents = this.watchVaultRawEvents.bind(this);
        plugin.registerEvent(plugin.app.vault.on("modify", this.watchVaultChange));
        plugin.registerEvent(plugin.app.vault.on("delete", this.watchVaultDelete));
        plugin.registerEvent(plugin.app.vault.on("rename", this.watchVaultRename));
        plugin.registerEvent(plugin.app.vault.on("create", this.watchVaultCreate));
        //@ts-ignore : Internal API
        plugin.registerEvent(plugin.app.vault.on("raw", this.watchVaultRawEvents));
        // plugin.fileEventQueue.startPipeline();
    }

    watchVaultCreate(file: TAbstractFile, ctx?: any) {
        this.appendQueue([{ type: "CREATE", file }], ctx);
    }

    watchVaultChange(file: TAbstractFile, ctx?: any) {
        this.appendQueue([{ type: "CHANGED", file }], ctx);
    }

    watchVaultDelete(file: TAbstractFile, ctx?: any) {
        this.appendQueue([{ type: "DELETE", file }], ctx);
    }
    watchVaultRename(file: TAbstractFile, oldFile: string, ctx?: any) {
        if (file instanceof TFile) {
            this.appendQueue([
                { type: "DELETE", file: { path: oldFile as FilePath, mtime: file.stat.mtime, ctime: file.stat.ctime, size: file.stat.size, deleted: true }, skipBatchWait: true },
                { type: "CREATE", file, skipBatchWait: true },
            ], ctx);
        }
    }
    // Watch raw events (Internal API)
    watchVaultRawEvents(path: FilePath) {
        if (this.plugin.settings.useIgnoreFiles && this.plugin.ignoreFiles.some(e => path.endsWith(e.trim()))) {
            // If it is one of ignore files, refresh the cached one.
            this.plugin.isTargetFile(path).then(() => this._watchVaultRawEvents(path));
        } else {
            this._watchVaultRawEvents(path);
        }
    }

    _watchVaultRawEvents(path: FilePath) {
        if (!this.plugin.settings.syncInternalFiles && !this.plugin.settings.usePluginSync) return;
        if (!this.plugin.settings.watchInternalFileChanges) return;
        if (!path.startsWith(this.plugin.app.vault.configDir)) return;
        const ignorePatterns = this.plugin.settings.syncInternalFilesIgnorePatterns
            .replace(/\n| /g, "")
            .split(",").filter(e => e).map(e => new RegExp(e, "i"));
        if (ignorePatterns.some(e => path.match(e))) return;
        this.appendQueue(
            [{
                type: "INTERNAL",
                file: { path, mtime: 0, ctime: 0, size: 0 }
            }], null);
    }
    // Cache file and waiting to can be proceed.
    async appendQueue(params: FileEvent[], ctx?: any) {
        if (!this.plugin.settings.isConfigured) return;
        if (this.plugin.settings.suspendFileWatching) return;
        const processFiles = new Set<FilePath>();
        for (const param of params) {
            if (shouldBeIgnored(param.file.path)) {
                continue;
            }
            const atomicKey = [0, 0, 0, 0, 0, 0].map(e => `${Math.floor(Math.random() * 100000)}`).join("-");
            const type = param.type;
            const file = param.file;
            const oldPath = param.oldPath;
            const size = file instanceof TFile ? file.stat.size : (file as InternalFileInfo)?.size ?? 0;
            if (this.plugin.isFileSizeExceeded(size) && (type == "CREATE" || type == "CHANGED")) {
                Logger(`The storage file has been changed but exceeds the maximum size. Skipping: ${param.file.path}`, LOG_LEVEL_NOTICE);
                continue;
            }
            if (file instanceof TFolder) continue;
            if (!await this.plugin.isTargetFile(file.path)) continue;

            // Stop cache using to prevent the corruption;
            // let cache: null | string | ArrayBuffer;
            // new file or something changed, cache the changes.
            if (file instanceof TFile && (type == "CREATE" || type == "CHANGED")) {
                // Wait for a bit while to let the writer has marked `touched` at the file.
                await delay(10);
                if (this.plugin.vaultAccess.recentlyTouched(file)) {
                    continue;
                }
            }
            const fileInfo = file instanceof TFile ? {
                ctime: file.stat.ctime,
                mtime: file.stat.mtime,
                file: file,
                path: file.path,
                size: file.stat.size
            } as FileInfo : file as InternalFileInfo;
            let cache: string | undefined = undefined;
            if (param.cachedData) {
                cache = param.cachedData
            }
            this.enqueue({
                type,
                args: {
                    file: fileInfo,
                    oldPath,
                    cache,
                    ctx,
                },
                skipBatchWait: param.skipBatchWait,
                key: atomicKey
            })
            processFiles.add(file.path as FilePath);
            if (oldPath) {
                processFiles.add(oldPath as FilePath);
            }
        }
        for (const path of processFiles) {
            fireAndForget(() => this.startStandingBy(path));
        }
    }
    bufferedQueuedItems = [] as FileEventItem[];

    enqueue(newItem: FileEventItem) {
        const filename = newItem.args.file.path;
        if (this.shouldBatchSave) {
            Logger(`Request cancel for waiting of previous ${filename}`, LOG_LEVEL_DEBUG);
            finishWaitingForTimeout(`storage-event-manager-batchsave-${filename}`);
        }
        this.bufferedQueuedItems.push(newItem);
        // When deleting or renaming, the queue must be flushed once before processing subsequent processes to prevent unexpected race condition.
        if (newItem.type == "DELETE" || newItem.type == "RENAME") {
            return this.flushQueue();
        }
    }
    concurrentProcessing = Semaphore(5);
    waitedSince = new Map<FilePath, number>();
    async startStandingBy(filename: FilePath) {
        // If waited, cancel previous waiting.
        await skipIfDuplicated(`storage-event-manager-${filename}`, async () => {
            Logger(`Processing ${filename}: Starting`, LOG_LEVEL_DEBUG);
            const release = await this.concurrentProcessing.acquire();
            try {
                Logger(`Processing ${filename}: Started`, LOG_LEVEL_DEBUG);
                let noMoreFiles = false;
                do {
                    const target = this.bufferedQueuedItems.find(e => e.args.file.path == filename);
                    if (target === undefined) {
                        noMoreFiles = true;
                        break;
                    }
                    const operationType = target.type;

                    // if (target.waitedFrom + this.batchSaveMaximumDelay > now) {
                    //     this.requestProcessQueue(target);
                    //     continue;
                    // }
                    const type = target.type;
                    if (target.cancelled) {
                        Logger(`Processing ${filename}: Cancelled (scheduled): ${operationType}`, LOG_LEVEL_DEBUG)
                        this.cancelStandingBy(target);
                        continue;
                    }
                    if (!target.skipBatchWait) {
                        if (this.shouldBatchSave && (type == "CREATE" || type == "CHANGED")) {
                            const waitedSince = this.waitedSince.get(filename);
                            let canWait = true;
                            const now = Date.now();
                            if (waitedSince !== undefined) {
                                if (waitedSince + (this.batchSaveMaximumDelay * 1000) < now) {
                                    Logger(`Processing ${filename}: Could not wait no more: ${operationType}`, LOG_LEVEL_INFO)
                                    canWait = false;
                                }
                            }
                            if (canWait) {
                                if (waitedSince === undefined) this.waitedSince.set(filename, now)
                                target.batched = true
                                Logger(`Processing ${filename}: Waiting for batch save delay: ${operationType}`, LOG_LEVEL_DEBUG)
                                this.updateStatus();
                                const result = await waitForTimeout(`storage-event-manager-batchsave-${filename}`, this.batchSaveMinimumDelay * 1000);
                                if (!result) {
                                    Logger(`Processing ${filename}: Cancelled by new queue: ${operationType}`, LOG_LEVEL_DEBUG)
                                    // If could not wait for the timeout, possibly we got a new queue. therefore, currently processing one should be cancelled
                                    this.cancelStandingBy(target);
                                    continue;
                                }
                            }
                        }
                    } else {
                        Logger(`Processing ${filename}:Requested to perform immediately ${filename}: ${operationType}`, LOG_LEVEL_DEBUG)
                    }
                    Logger(`Processing ${filename}: Request main to process: ${operationType}`, LOG_LEVEL_DEBUG)
                    this.requestProcessQueue(target);
                } while (!noMoreFiles)
            } finally {
                release()
            }
            Logger(`Processing ${filename}: Finished`, LOG_LEVEL_DEBUG);
        })
    }

    cancelStandingBy(fei: FileEventItem) {
        this.bufferedQueuedItems.remove(fei);
        this.updateStatus();
    }
    processingCount = 0;
    async requestProcessQueue(fei: FileEventItem) {
        try {
            this.processingCount++;
            this.bufferedQueuedItems.remove(fei);
            this.updateStatus()
            this.waitedSince.delete(fei.args.file.path);
            await this.plugin.handleFileEvent(fei);
        } finally {
            this.processingCount--;
            this.updateStatus()
        }
    }
    isWaiting(filename: FilePath) {
        return isWaitingForTimeout(`storage-event-manager-batchsave-${filename}`);
    }
    flushQueue() {
        this.bufferedQueuedItems.forEach(e => e.skipBatchWait = true)
        finishAllWaitingForTimeout("storage-event-manager-batchsave-", true);
    }
    cancelQueue(key: string) {
        this.bufferedQueuedItems.forEach(e => {
            if (e.key === key) e.skipBatchWait = true
        })
    }
    updateStatus() {
        const allItems = this.bufferedQueuedItems.filter(e => !e.cancelled)
        this.batched.value = allItems.filter(e => e.batched && !e.skipBatchWait).length;
        this.processing.value = this.processingCount;
        this.totalQueued.value = allItems.length - this.batched.value;
    }
}