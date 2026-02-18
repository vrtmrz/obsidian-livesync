import type { FileEventItem } from "@/common/types";
import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync";
import type { FilePath, UXFileInfoStub, UXFolderInfo, UXInternalFileInfoStub } from "@lib/common/types";
import type { FileEvent } from "@lib/interfaces/StorageEventManager";
import { TFile, type TAbstractFile, TFolder } from "@/deps";
import { LOG_LEVEL_DEBUG } from "octagonal-wheels/common/logger";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import {
    StorageEventManagerBase,
    type FileEventItemSentinel,
    type StorageEventManagerBaseDependencies,
} from "@lib/managers/StorageEventManager";
import { InternalFileToUXFileInfoStub, TFileToUXFileInfoStub } from "@/modules/coreObsidian/storageLib/utilObsidian";

export class StorageEventManagerObsidian extends StorageEventManagerBase {
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncCore;

    // Necessary evil.
    cmdHiddenFileSync: HiddenFileSync;

    override isFile(file: UXFileInfoStub | UXInternalFileInfoStub | UXFolderInfo | TFile): boolean {
        if (file instanceof TFile) {
            return true;
        }
        if (super.isFile(file)) {
            return true;
        }
        return !file.isFolder;
    }
    override isFolder(file: UXFileInfoStub | UXInternalFileInfoStub | UXFolderInfo | TFolder): boolean {
        if (file instanceof TFolder) {
            return true;
        }
        if (super.isFolder(file)) {
            return true;
        }
        return !!file.isFolder;
    }

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, dependencies: StorageEventManagerBaseDependencies) {
        super(dependencies);
        this.plugin = plugin;
        this.core = core;
        this.cmdHiddenFileSync = this.plugin.getAddOn(HiddenFileSync.name) as HiddenFileSync;
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
            // this._log(`Editor change skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
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
            // this._log(`File create skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        const fileInfo = TFileToUXFileInfoStub(file);
        void this.appendQueue([{ type: "CREATE", file: fileInfo }], ctx);
    }

    watchVaultChange(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        if (this.storageAccess.isFileProcessing(file.path as FilePath)) {
            // this._log(`File change skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        const fileInfo = TFileToUXFileInfoStub(file);
        void this.appendQueue([{ type: "CHANGED", file: fileInfo }], ctx);
    }

    watchVaultDelete(file: TAbstractFile, ctx?: any) {
        if (file instanceof TFolder) return;
        if (this.storageAccess.isFileProcessing(file.path as FilePath)) {
            // this._log(`File delete skipped because the file is being processed: ${file.path}`, LOG_LEVEL_VERBOSE);
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
            // this._log(`Raw file event skipped because the file is being processed: ${path}`, LOG_LEVEL_VERBOSE);
            return;
        }
        // Only for internal files.
        if (!this.settings) return;
        // if (this.plugin.settings.useIgnoreFiles && this.plugin.ignoreFiles.some(e => path.endsWith(e.trim()))) {
        if (this.settings.useIgnoreFiles) {
            // If it is one of ignore files, refresh the cached one.
            // (Calling$$isTargetFile will refresh the cache)
            void this.vaultService.isTargetFile(path).then(() => this._watchVaultRawEvents(path));
        } else {
            void this._watchVaultRawEvents(path);
        }
    }

    async _watchVaultRawEvents(path: FilePath) {
        if (!this.settings.syncInternalFiles && !this.settings.usePluginSync) return;
        if (!this.settings.watchInternalFileChanges) return;
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

    async _saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]) {
        await this.core.kvDB.set("storage-event-manager-snapshot", snapshot);
        this._log(`Storage operation snapshot saved: ${snapshot.length} items`, LOG_LEVEL_DEBUG);
    }

    async _loadSnapshot() {
        const snapShot = await this.core.kvDB.get<(FileEventItem | FileEventItemSentinel)[]>(
            "storage-event-manager-snapshot"
        );
        return snapShot;
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
}
