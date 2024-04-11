import type { SerializedFileAccess } from "./SerializedFileAccess";
import { Plugin, TAbstractFile, TFile, TFolder } from "./deps";
import { Logger } from "./lib/src/logger";
import { shouldBeIgnored } from "./lib/src/path";
import type { QueueProcessor } from "./lib/src/processor";
import { LOG_LEVEL_NOTICE, type FilePath, type ObsidianLiveSyncSettings } from "./lib/src/types";
import { delay } from "./lib/src/utils";
import { type FileEventItem, type FileEventType, type FileInfo, type InternalFileInfo } from "./types";


export abstract class StorageEventManager {
    abstract beginWatch(): void;
}

type LiveSyncForStorageEventManager = Plugin &
{
    settings: ObsidianLiveSyncSettings
    ignoreFiles: string[],
    vaultAccess: SerializedFileAccess
} & {
    isTargetFile: (file: string | TAbstractFile) => Promise<boolean>,
    fileEventQueue: QueueProcessor<FileEventItem, any>,
    isFileSizeExceeded: (size: number) => boolean;
};


export class StorageEventManagerObsidian extends StorageEventManager {
    plugin: LiveSyncForStorageEventManager;
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
        plugin.fileEventQueue.startPipeline();
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
        if (!this.plugin.settings.isConfigured) return;
        if (this.plugin.settings.suspendFileWatching) return;
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
                // cache = await this.plugin.vaultAccess.vaultReadAuto(file);
                // if (!isPlainText(file.name)) {
                //     cache = await this.plugin.vaultAccess.vaultReadBinary(file);
                // } else {
                //     cache = await this.plugin.vaultAccess.vaultCacheRead(file);
                //     if (!cache) cache = await this.plugin.vaultAccess.vaultRead(file);
                // }
            }
            const fileInfo = file instanceof TFile ? {
                ctime: file.stat.ctime,
                mtime: file.stat.mtime,
                file: file,
                path: file.path,
                size: file.stat.size
            } as FileInfo : file as InternalFileInfo;
            this.plugin.fileEventQueue.enqueue({
                type,
                args: {
                    file: fileInfo,
                    oldPath,
                    // cache,
                    ctx
                },
                key: atomicKey
            })
        }
    }
}