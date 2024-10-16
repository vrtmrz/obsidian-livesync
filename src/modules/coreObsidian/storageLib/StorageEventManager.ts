import { TAbstractFile, TFile, TFolder } from "../../../deps.ts";
import { Logger } from "../../../lib/src/common/logger.ts";
import { shouldBeIgnored } from "../../../lib/src/string_and_binary/path.ts";
import { LOG_LEVEL_DEBUG, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, type FilePath, type FilePathWithPrefix, type UXFileInfoStub, type UXInternalFileInfoStub } from "../../../lib/src/common/types.ts";
import { delay, fireAndForget } from "../../../lib/src/common/utils.ts";
import { type FileEventItem, type FileEventType } from "../../../common/types.ts";
import { serialized, skipIfDuplicated } from "../../../lib/src/concurrency/lock.ts";
import { finishAllWaitingForTimeout, finishWaitingForTimeout, isWaitingForTimeout, waitForTimeout } from "../../../lib/src/concurrency/task.ts";
import { reactiveSource, type ReactiveSource } from "../../../lib/src/dataobject/reactive.ts";
import { Semaphore } from "../../../lib/src/concurrency/semaphore.ts";
import type { LiveSyncCore } from "../../../main.ts";
import { InternalFileToUXFileInfoStub, TFileToUXFileInfoStub } from "./utilObsidian.ts";
import ObsidianLiveSyncPlugin from "../../../main.ts";
// import { InternalFileToUXFileInfo } from "../platforms/obsidian.ts";


export type FileEvent = {
    type: FileEventType;
    file: UXFileInfoStub | UXInternalFileInfoStub;
    oldPath?: string;
    cachedData?: string;
    skipBatchWait?: boolean;
};


export abstract class StorageEventManager {
    abstract beginWatch(): void;
    abstract flushQueue(): void;
    abstract appendQueue(items: FileEvent[], ctx?: any): Promise<void>;
    abstract cancelQueue(key: string): void;
    abstract isWaiting(filename: FilePath): boolean;
    abstract totalQueued: ReactiveSource<number>;
    abstract batched: ReactiveSource<number>;
    abstract processing: ReactiveSource<number>;

}


export class StorageEventManagerObsidian extends StorageEventManager {
    totalQueued = reactiveSource(0);
    batched = reactiveSource(0);
    processing = reactiveSource(0);
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncCore;

    get shouldBatchSave() {
        return this.plugin.shouldBatchSave;
    }
    get batchSaveMinimumDelay(): number {
        return this.plugin.batchSaveMinimumDelay;
    }
    get batchSaveMaximumDelay(): number {
        return this.plugin.batchSaveMaximumDelay
    }
    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore) {
        super();
        this.plugin = plugin;
        this.core = core;
    }
    beginWatch() {
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

        // plugin.fileEventQueue.startPipeline();
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
        if (!this.isWaiting(file.path as FilePath)) {
            return;
        }
        const data = info?.data as string;
        const fi: FileEvent = {
            type: "CHANGED", file: TFileToUXFileInfoStub(file), cachedData: data,
        }
        void this.appendQueue([
            fi])
    }

    watchVaultCreate(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        const fileInfo = TFileToUXFileInfoStub(file);
        void this.appendQueue([{ type: "CREATE", file: fileInfo }], ctx);
    }

    watchVaultChange(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        const fileInfo = TFileToUXFileInfoStub(file);
        void this.appendQueue([{ type: "CHANGED", file: fileInfo }], ctx);
    }

    watchVaultDelete(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        const fileInfo = TFileToUXFileInfoStub(file, true);
        void this.appendQueue([{ type: "DELETE", file: fileInfo }], ctx);
    }
    watchVaultRename(file: TAbstractFile, oldFile: string, ctx?: any) {
        if (file instanceof TFile) {
            const fileInfo = TFileToUXFileInfoStub(file);
            void this.appendQueue([
                {
                    type: "DELETE", file: {
                        path: oldFile as FilePath, name: file.name, stat: {
                            mtime: file.stat.mtime,
                            ctime: file.stat.ctime,
                            size: file.stat.size,
                            type: "file"
                        }, deleted: true
                    }, skipBatchWait: true
                }, { type: "CREATE", file: fileInfo, skipBatchWait: true },], ctx);
        }
    }
    // Watch raw events (Internal API)
    watchVaultRawEvents(path: FilePath) {
        // Only for internal files.
        if (!this.plugin.settings) return;
        // if (this.plugin.settings.useIgnoreFiles && this.plugin.ignoreFiles.some(e => path.endsWith(e.trim()))) {
        if (this.plugin.settings.useIgnoreFiles) {
            // If it is one of ignore files, refresh the cached one.
            // (Calling$$isTargetFile will refresh the cache)
            void this.plugin.$$isTargetFile(path).then(() => this._watchVaultRawEvents(path));
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
        if (path.endsWith("/")) {
            // Folder 
            return;
        }
        void this.appendQueue([
            {
                type: "INTERNAL", file: InternalFileToUXFileInfoStub(path),
            }], null);
    }
    // Cache file and waiting to can be proceed.
    async appendQueue(params: FileEvent[], ctx?: any) {
        if (!this.plugin.settings.isConfigured) return;
        if (this.plugin.settings.suspendFileWatching) return;
        this.plugin.totalFileEventCount++;
        // Flag up to be reload
        const processFiles = new Set<FilePath>();
        for (const param of params) {
            if (shouldBeIgnored(param.file.path)) {
                continue;
            }
            const atomicKey = [
                0,
                0,
                0,
                0,
                0,
                0].map(e => `${Math.floor(Math.random() * 100000)}`).join("-");
            const type = param.type;
            const file = param.file;
            const oldPath = param.oldPath;
            if (type !== "INTERNAL") {
                const size = (file as UXFileInfoStub).stat.size;
                if (this.plugin.$$isFileSizeExceeded(size) && (type == "CREATE" || type == "CHANGED")) {
                    Logger(`The storage file has been changed but exceeds the maximum size. Skipping: ${param.file.path}`, LOG_LEVEL_NOTICE);
                    continue;
                }
            }
            if (file instanceof TFolder) continue;
            if (!await this.plugin.$$isTargetFile(file.path)) continue;

            // Stop cache using to prevent the corruption;
            // let cache: null | string | ArrayBuffer;
            // new file or something changed, cache the changes.
            if (file instanceof TFile && (type == "CREATE" || type == "CHANGED")) {
                // Wait for a bit while to let the writer has marked `touched` at the file.
                await delay(10);
                if (this.plugin.storageAccess.recentlyTouched(file)) {
                    continue;
                }
            }

            let cache: string | undefined = undefined;
            if (param.cachedData) {
                cache = param.cachedData
            }
            this.enqueue({
                type, args: {
                    file: file, oldPath, cache, ctx,
                }, skipBatchWait: param.skipBatchWait, key: atomicKey
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
        if (newItem.type == "DELETE") {
            return this.flushQueue();
        }
    }
    concurrentProcessing = Semaphore(5);
    waitedSince = new Map<FilePath | FilePathWithPrefix, number>();
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
                    await this.requestProcessQueue(target);
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
            await this.handleFileEvent(fei);
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

    async handleFileEvent(queue: FileEventItem): Promise<any> {
        const file = queue.args.file;
        const lockKey = `handleFile:${file.path}`;
        return await serialized(lockKey, async () => {
            // TODO CHECK
            // console.warn(lockKey);
            const key = `file-last-proc-${queue.type}-${file.path}`;
            const last = Number(await this.core.kvDB.get(key) || 0);
            if (queue.type == "INTERNAL" || file.isInternal) {
                await this.plugin.$anyProcessOptionalFileEvent(file.path as unknown as FilePath);
            } else {
                // let mtime = file.stat.mtime;
                if (queue.type == "DELETE") {
                    await this.plugin.$anyHandlerProcessesFileEvent(queue);
                } else {
                    if (file.stat.mtime == last) {
                        Logger(`File has been already scanned on ${queue.type}, skip: ${file.path}`, LOG_LEVEL_VERBOSE);
                        // Should Cancel the relative operations? (e.g. rename) 
                        // this.cancelRelativeEvent(queue);
                        return;
                    }
                    if (!await this.plugin.$anyHandlerProcessesFileEvent(queue)) {
                        Logger(`STORAGE -> DB: Handler failed, cancel the relative operations: ${file.path}`, LOG_LEVEL_INFO);
                        // cancel running queues and remove one of atomic operation (e.g. rename) 
                        this.cancelRelativeEvent(queue);
                        return;
                    }
                    //     if (queue.type == "CREATE" || queue.type == "CHANGED") {
                    //                 // eventHub.emitEvent("event-file-changed", { file: targetFile, automated: true });

                    //                 if (!await this.core.updateIntoDB(targetFile, undefined)) {
                    //                     Logger(`STORAGE -> DB: failed, cancel the relative operations: ${targetFile.path}`, LOG_LEVEL_INFO);
                    //                     // cancel running queues and remove one of atomic operation
                    //                     this.cancelRelativeEvent(queue);
                    //                     return;
                    //                 }
                    //             }
                    //             if (queue.type == "RENAME") {
                    //                 // Obsolete , can be called? 
                    //                 await this.renameVaultItem(targetFile, queue.args.oldPath);
                    //             }
                    // }
                    //     await this.core.deleteFromDBbyPath(file.path);
                    //     mtime = file.stat.mtime - 1;
                    //     const keyD1 = `file-last-proc-CREATE-${file.path}`;
                    //     const keyD2 = `file-last-proc-CHANGED-${file.path}`;
                    //     await this.core.kvDB.set(keyD1, mtime);
                    //     await this.core.kvDB.set(keyD2, mtime);
                    // } else {
                    //     const targetFile = this.core.storageAccess.getFileStub(file.path);
                    //     if (!(targetFile)) {
                    //         Logger(`Target file was not found: ${file.path}`, LOG_LEVEL_INFO);
                    //         return;
                    //     }
                    //     if (file.stat.mtime == last) {
                    //         Logger(`File has been already scanned on ${queue.type}, skip: ${file.path}`, LOG_LEVEL_VERBOSE);
                    //         return;
                    //     }

                    //     // const cache = queue.args.cache;
                    //     if (queue.type == "CREATE" || queue.type == "CHANGED") {
                    //         eventHub.emitEvent("event-file-changed", { file: targetFile, automated: true });
                    //         // fireAndForget(() => this.addOnObsidianUI.checkAndApplySettingFromMarkdown(queue.args.file.path, true));
                    //         const keyD1 = `file-last-proc-DELETED-${file.path}`;
                    //         await this.core.kvDB.set(keyD1, mtime);
                    //         if (!await this.core.updateIntoDB(targetFile, undefined)) {
                    //             Logger(`STORAGE -> DB: failed, cancel the relative operations: ${targetFile.path}`, LOG_LEVEL_INFO);
                    //             // cancel running queues and remove one of atomic operation
                    //             this.cancelRelativeEvent(queue);
                    //             return;
                    //         }
                    //     }
                    //     if (queue.type == "RENAME") {
                    //         // Obsolete , can be called? 
                    //         await this.renameVaultItem(targetFile, queue.args.oldPath);
                    //     }
                    // }
                    // await this.core.kvDB.set(key, mtime);
                }
            }
        });
    }
    // async renameVaultItem(file: UXFileInfoStub, oldFile: any, cache?: CacheData): Promise<void> {
    //     Logger(`${oldFile} renamed to ${file.path}`, LOG_LEVEL_VERBOSE);
    //     if (!file.isFolder) {
    //         try {
    //             // Logger(`RENAMING.. ${file.path} into db`);
    //             if (await this.core.updateIntoDB(file, cache)) {
    //                 // Logger(`deleted ${oldFile} from db`);
    //                 await this.core.deleteFromDBbyPath(oldFile);
    //             } else {
    //                 Logger(`Could not save new file: ${file.path} `, LOG_LEVEL_NOTICE);
    //             }
    //         } catch (ex) {
    //             Logger(ex);
    //         }
    //     }
    // }
    cancelRelativeEvent(item: FileEventItem): void {
        this.cancelQueue(item.key);
    }
}