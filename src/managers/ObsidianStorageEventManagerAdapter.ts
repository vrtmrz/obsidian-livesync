import { TFile, TFolder } from "@/deps";
import type { FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/types";
import type { FileEventItem } from "@lib/common/types";
import type { IStorageEventManagerAdapter } from "@lib/managers/adapters";
import type {
    IStorageEventTypeGuardAdapter,
    IStorageEventPersistenceAdapter,
    IStorageEventWatchAdapter,
    IStorageEventStatusAdapter,
    IStorageEventConverterAdapter,
    IStorageEventWatchHandlers,
} from "@lib/managers/adapters";
import type { FileEventItemSentinel } from "@lib/managers/StorageEventManager";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import type { FileProcessingService } from "@lib/services/base/FileProcessingService";
import { InternalFileToUXFileInfoStub, TFileToUXFileInfoStub } from "@/modules/coreObsidian/storageLib/utilObsidian";

/**
 * Obsidian-specific type guard adapter
 */
class ObsidianTypeGuardAdapter implements IStorageEventTypeGuardAdapter<TFile, TFolder> {
    isFile(file: any): file is TFile {
        if (file instanceof TFile) {
            return true;
        }
        if (file && typeof file === "object" && "isFolder" in file) {
            return !file.isFolder;
        }
        return false;
    }

    isFolder(item: any): item is TFolder {
        if (item instanceof TFolder) {
            return true;
        }
        if (item && typeof item === "object" && "isFolder" in item) {
            return !!item.isFolder;
        }
        return false;
    }
}

/**
 * Obsidian-specific persistence adapter
 */
class ObsidianPersistenceAdapter implements IStorageEventPersistenceAdapter {
    constructor(private core: LiveSyncCore) {}

    async saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]): Promise<void> {
        await this.core.kvDB.set("storage-event-manager-snapshot", snapshot);
    }

    async loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null> {
        const snapShot = await this.core.kvDB.get<(FileEventItem | FileEventItemSentinel)[]>(
            "storage-event-manager-snapshot"
        );
        return snapShot;
    }
}

/**
 * Obsidian-specific status adapter
 */
class ObsidianStatusAdapter implements IStorageEventStatusAdapter {
    constructor(private fileProcessing: FileProcessingService) {}

    updateStatus(status: { batched: number; processing: number; totalQueued: number }): void {
        this.fileProcessing.batched.value = status.batched;
        this.fileProcessing.processing.value = status.processing;
        this.fileProcessing.totalQueued.value = status.totalQueued;
    }
}

/**
 * Obsidian-specific converter adapter
 */
class ObsidianConverterAdapter implements IStorageEventConverterAdapter<TFile> {
    toFileInfo(file: TFile, deleted?: boolean): UXFileInfoStub {
        return TFileToUXFileInfoStub(file, deleted);
    }

    toInternalFileInfo(path: FilePath): UXInternalFileInfoStub {
        return InternalFileToUXFileInfoStub(path);
    }
}

/**
 * Obsidian-specific watch adapter
 */
class ObsidianWatchAdapter implements IStorageEventWatchAdapter {
    constructor(private plugin: ObsidianLiveSyncPlugin) {}

    beginWatch(handlers: IStorageEventWatchHandlers): Promise<void> {
        const plugin = this.plugin;

        const boundHandlers = {
            onCreate: handlers.onCreate.bind(handlers),
            onChange: handlers.onChange.bind(handlers),
            onDelete: handlers.onDelete.bind(handlers),
            onRename: handlers.onRename.bind(handlers),
            onRaw: handlers.onRaw.bind(handlers),
            onEditorChange: handlers.onEditorChange?.bind(handlers),
        };

        plugin.registerEvent(plugin.app.vault.on("create", boundHandlers.onCreate));
        plugin.registerEvent(plugin.app.vault.on("modify", boundHandlers.onChange));
        plugin.registerEvent(plugin.app.vault.on("delete", boundHandlers.onDelete));
        plugin.registerEvent(plugin.app.vault.on("rename", boundHandlers.onRename));
        //@ts-ignore : Internal API
        plugin.registerEvent(plugin.app.vault.on("raw", boundHandlers.onRaw));
        if (boundHandlers.onEditorChange) {
            plugin.registerEvent(plugin.app.workspace.on("editor-change", boundHandlers.onEditorChange));
        }

        return Promise.resolve();
    }
}

/**
 * Composite adapter for Obsidian StorageEventManager
 */
export class ObsidianStorageEventManagerAdapter implements IStorageEventManagerAdapter<TFile, TFolder> {
    readonly typeGuard: ObsidianTypeGuardAdapter;
    readonly persistence: ObsidianPersistenceAdapter;
    readonly watch: ObsidianWatchAdapter;
    readonly status: ObsidianStatusAdapter;
    readonly converter: ObsidianConverterAdapter;

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, fileProcessing: FileProcessingService) {
        this.typeGuard = new ObsidianTypeGuardAdapter();
        this.persistence = new ObsidianPersistenceAdapter(core);
        this.watch = new ObsidianWatchAdapter(plugin);
        this.status = new ObsidianStatusAdapter(fileProcessing);
        this.converter = new ObsidianConverterAdapter();
    }
}
