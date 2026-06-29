// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath } from "@lib/common/types";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import { StorageEventManagerBase, type StorageEventManagerBaseDependencies } from "@lib/managers/StorageEventManager";
import { ObsidianStorageEventManagerAdapter } from "./ObsidianStorageEventManagerAdapter";
export declare class StorageEventManagerObsidian extends StorageEventManagerBase<ObsidianStorageEventManagerAdapter> {
    core: LiveSyncCore;
    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, dependencies: StorageEventManagerBaseDependencies);
    /**
     * Override _watchVaultRawEvents to add Obsidian-specific logic
     */
    protected _watchVaultRawEvents(path: FilePath): Promise<void>;
}
