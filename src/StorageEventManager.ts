import { Plugin, TAbstractFile, TFile, TFolder } from "./deps";
import { isPlainText, shouldBeIgnored } from "./lib/src/path";
import { getGlobalStore } from "./lib/src/store";
import { type FilePath, type ObsidianLiveSyncSettings } from "./lib/src/types";
import { type FileEventItem, type FileEventType, type FileInfo, type InternalFileInfo, type queueItem } from "./types";
import { recentlyTouched } from "./utils";


export abstract class StorageEventManager {
    abstract fetchEvent(): FileEventItem | false;
    abstract cancelRelativeEvent(item: FileEventItem): void;
    abstract getQueueLength(): number;
}

type LiveSyncForStorageEventManager = Plugin &
{
    settings: ObsidianLiveSyncSettings
    ignoreFiles: string[],
} & {
    isTargetFile: (file: string | TAbstractFile) => Promise<boolean>,
    procFileEvent: (applyBatch?: boolean) => Promise<boolean>,
};


export class StorageEventManagerObsidian extends StorageEventManager {
    plugin: LiveSyncForStorageEventManager;
    queuedFilesStore = getGlobalStore("queuedFiles", { queuedItems: [] as queueItem[], fileEventItems: [] as FileEventItem[] });

    watchedFileEventQueue = [] as FileEventItem[];

    constructor(plugin: LiveSyncForStorageEventManager) {
        super();
        this.plugin = plugin;
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
    }

    watchVaultCreate(file: TAbstractFile, ctx?: any) {
        this.appendWatchEvent([{ type: "CREATE", file }], ctx);
    }

    watchVaultChange(file: TAbstractFile, ctx?: any) {
        this.appendWatchEvent([{ type: "CHANGED", file }], ctx);
    }

    watchVaultDelete(file: TAbstractFile, ctx?: any) {
        this.appendWatchEvent([{ type: "DELETE", file }], ctx);
    }
    watchVaultRename(file: TAbstractFile, oldFile: string, ctx?: any) {
        if (file instanceof TFile) {
            this.appendWatchEvent([
                { type: "DELETE", file: { path: oldFile as FilePath, mtime: file.stat.mtime, ctime: file.stat.ctime, size: file.stat.size, deleted: true } },
                { type: "CREATE", file },
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
        this.appendWatchEvent(
            [{
                type: "INTERNAL",
                file: { path, mtime: 0, ctime: 0, size: 0 }
            }], null);
    }
    // Cache file and waiting to can be proceed.
    async appendWatchEvent(params: { type: FileEventType, file: TAbstractFile | InternalFileInfo, oldPath?: string }[], ctx?: any) {
        let forcePerform = false;
        for (const param of params) {
            if (shouldBeIgnored(param.file.path)) {
                continue;
            }
            const atomicKey = [0, 0, 0, 0, 0, 0].map(e => `${Math.floor(Math.random() * 100000)}`).join("-");
            const type = param.type;
            const file = param.file;
            const oldPath = param.oldPath;
            if (file instanceof TFolder) continue;
            if (!await this.plugin.isTargetFile(file.path)) continue;
            if (this.plugin.settings.suspendFileWatching) continue;

            let cache: null | string | ArrayBuffer;
            // new file or something changed, cache the changes.
            if (file instanceof TFile && (type == "CREATE" || type == "CHANGED")) {
                if (recentlyTouched(file)) {
                    continue;
                }
                if (!isPlainText(file.name)) {
                    cache = await this.plugin.app.vault.readBinary(file);
                } else {
                    // cache = await this.app.vault.read(file);
                    cache = await this.plugin.app.vault.cachedRead(file);
                    if (!cache) cache = await this.plugin.app.vault.read(file);
                }
            }
            if (type == "DELETE" || type == "RENAME") {
                forcePerform = true;
            }


            if (this.plugin.settings.batchSave && !this.plugin.settings.liveSync) {
                // if the latest event is the same type, omit that
                // a.md MODIFY  <- this should be cancelled when a.md MODIFIED
                // b.md MODIFY    <- this should be cancelled when b.md MODIFIED
                // a.md MODIFY
                // a.md CREATE
                //     : 
                let i = this.watchedFileEventQueue.length;
                L1:
                while (i >= 0) {
                    i--;
                    if (i < 0) break L1;
                    if (this.watchedFileEventQueue[i].args.file.path != file.path) {
                        continue L1;
                    }
                    if (this.watchedFileEventQueue[i].type != type) break L1;
                    this.watchedFileEventQueue.remove(this.watchedFileEventQueue[i]);
                    //this.queuedFilesStore.set({ queuedItems: this.queuedFiles, fileEventItems: this.watchedFileEventQueue });
                    this.queuedFilesStore.apply((value) => ({ ...value, fileEventItems: this.watchedFileEventQueue }));
                }
            }

            const fileInfo = file instanceof TFile ? {
                ctime: file.stat.ctime,
                mtime: file.stat.mtime,
                file: file,
                path: file.path,
                size: file.stat.size
            } as FileInfo : file as InternalFileInfo;
            this.watchedFileEventQueue.push({
                type,
                args: {
                    file: fileInfo,
                    oldPath,
                    cache,
                    ctx
                },
                key: atomicKey
            })
        }
        // this.queuedFilesStore.set({ queuedItems: this.queuedFiles, fileEventItems: this.watchedFileEventQueue });
        this.queuedFilesStore.apply((value) => ({ ...value, fileEventItems: this.watchedFileEventQueue }));
        this.plugin.procFileEvent(forcePerform);
    }
    fetchEvent(): FileEventItem | false {
        if (this.watchedFileEventQueue.length == 0) return false;
        const item = this.watchedFileEventQueue.shift();
        this.queuedFilesStore.apply((value) => ({ ...value, fileEventItems: this.watchedFileEventQueue }));
        return item;
    }
    cancelRelativeEvent(item: FileEventItem) {
        this.watchedFileEventQueue = [...this.watchedFileEventQueue].filter(e => e.key != item.key);
        this.queuedFilesStore.apply((value) => ({ ...value, fileEventItems: this.watchedFileEventQueue }));
    }
    getQueueLength() {
        return this.watchedFileEventQueue.length;
    }
}