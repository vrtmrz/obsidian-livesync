import type { FilePath } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import {
    StorageEventManagerBase,
    type StorageEventManagerBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import { ObsidianStorageEventManagerAdapter } from "./ObsidianStorageEventManagerAdapter";

export class StorageEventManagerObsidian extends StorageEventManagerBase<ObsidianStorageEventManagerAdapter> {
    core: LiveSyncCore;

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, dependencies: StorageEventManagerBaseDependencies) {
        const adapter = new ObsidianStorageEventManagerAdapter(plugin, core, dependencies.fileProcessing);
        super(adapter, dependencies);
        this.core = core;
    }

    /**
     * Override _watchVaultRawEvents to add Obsidian-specific logic
     */
    protected override async _watchVaultRawEvents(path: FilePath) {
        if (!this.settings.syncInternalFiles && !this.settings.usePluginSync) return;
        if (!this.settings.watchInternalFileChanges) return;
        if (!this.settings.isConfigured || this.settings.suspendFileWatching) return;
        if (this.settings.maxMTimeForReflectEvents > 0) return;
        if (!path.startsWith(this.core.services.API.getSystemConfigDir())) return;
        if (path.endsWith("/")) {
            // Folder
            return;
        }
        const isTargetFile = await this.vaultService.isTargetFileInExtra(path);
        if (!isTargetFile) return;

        // Commonlib's ordinary queue excludes every dot path when Hidden File
        // Sync is disabled. A Customisation-only event has already passed the
        // optional-file policy, so dispatch it without that unrelated gate.
        if (!this.settings.syncInternalFiles) {
            this.fileProcessing.onStorageFileEvent();
            await this.fileProcessing.processOptionalFileEvent(path);
            return;
        }

        void this.appendQueue(
            [
                {
                    type: "INTERNAL",
                    file: this.adapter.converter.toInternalFileInfo(path),
                    skipBatchWait: true, // Internal files should be processed immediately.
                },
            ],
            null
        );
    }
}
