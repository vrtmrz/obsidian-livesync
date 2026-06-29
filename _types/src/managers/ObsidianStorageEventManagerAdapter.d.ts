// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { TFile, TFolder } from "@/deps";
import type { FilePath, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/types";
import type { FileEventItem } from "@lib/common/types";
import type { IStorageEventManagerAdapter } from "@lib/managers/adapters";
import type { IStorageEventTypeGuardAdapter, IStorageEventPersistenceAdapter, IStorageEventWatchAdapter, IStorageEventStatusAdapter, IStorageEventConverterAdapter, IStorageEventWatchHandlers } from "@lib/managers/adapters";
import type { FileEventItemSentinel } from "@lib/managers/StorageEventManager";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import type { FileProcessingService } from "@lib/services/base/FileProcessingService";
/**
 * Obsidian-specific type guard adapter
 */
declare class ObsidianTypeGuardAdapter implements IStorageEventTypeGuardAdapter<TFile, TFolder> {
    isFile(file: unknown): file is TFile;
    isFolder(item: unknown): item is TFolder;
}
/**
 * Obsidian-specific persistence adapter
 */
declare class ObsidianPersistenceAdapter implements IStorageEventPersistenceAdapter {
    private core;
    constructor(core: LiveSyncCore);
    saveSnapshot(snapshot: (FileEventItem | FileEventItemSentinel)[]): Promise<void>;
    loadSnapshot(): Promise<(FileEventItem | FileEventItemSentinel)[] | null>;
}
/**
 * Obsidian-specific status adapter
 */
declare class ObsidianStatusAdapter implements IStorageEventStatusAdapter {
    private fileProcessing;
    constructor(fileProcessing: FileProcessingService);
    updateStatus(status: {
        batched: number;
        processing: number;
        totalQueued: number;
    }): void;
}
/**
 * Obsidian-specific converter adapter
 */
declare class ObsidianConverterAdapter implements IStorageEventConverterAdapter<TFile> {
    toFileInfo(file: TFile, deleted?: boolean): UXFileInfoStub;
    toInternalFileInfo(path: FilePath): UXInternalFileInfoStub;
}
/**
 * Obsidian-specific watch adapter
 */
declare class ObsidianWatchAdapter implements IStorageEventWatchAdapter {
    private plugin;
    constructor(plugin: ObsidianLiveSyncPlugin);
    beginWatch(handlers: IStorageEventWatchHandlers): Promise<void>;
}
/**
 * Composite adapter for Obsidian StorageEventManager
 */
export declare class ObsidianStorageEventManagerAdapter implements IStorageEventManagerAdapter<TFile, TFolder> {
    readonly typeGuard: ObsidianTypeGuardAdapter;
    readonly persistence: ObsidianPersistenceAdapter;
    readonly watch: ObsidianWatchAdapter;
    readonly status: ObsidianStatusAdapter;
    readonly converter: ObsidianConverterAdapter;
    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, fileProcessing: FileProcessingService);
}
export {};
