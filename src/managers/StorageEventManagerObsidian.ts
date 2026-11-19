import { fireAndForget } from "octagonal-wheels/promises";
import type { FilePath, FileEventItem } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import {
    StorageEventManagerBase,
    type StorageEventManagerBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import {
    isCaseInsensitiveSelection,
    pathWithinConfigDirectory,
} from "@/features/HiddenFileCommon/optionalFileSyncSelection";
import { ObsidianStorageEventManagerAdapter } from "./ObsidianStorageEventManagerAdapter";

export class StorageEventManagerObsidian extends StorageEventManagerBase<ObsidianStorageEventManagerAdapter> {
    core: LiveSyncCore;

    // Necessary evil.
    // cmdHiddenFileSync: HiddenFileSync;

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, dependencies: StorageEventManagerBaseDependencies) {
        const adapter = new ObsidianStorageEventManagerAdapter(plugin, core, dependencies.fileProcessing);
        super(adapter, {
            ...dependencies,
            isTargetInternalFile:
                dependencies.isTargetInternalFile ??
                ((path) => dependencies.vaultService.isTargetFile(path, { internalFileEvent: true })),
        });
        this.core = core;
    }

    protected override async handleFileEvent(event: FileEventItem): Promise<void> {
        const database = this.core.services.database;
        const selected = database.localDatabaseDirect;
        try {
            await super.handleFileEvent(event);
        } catch (error) {
            // Recovery drains this event before replacement. Awaiting it here would prevent that drain.
            if (selected) {
                fireAndForget(() => database.onLocalDatabaseError(selected, error));
            }
            throw error;
        }
    }

    /**
     * Override _watchVaultRawEvents to add Obsidian-specific logic
     */
    protected override async _watchVaultRawEvents(path: FilePath) {
        if (!this.settings.syncInternalFiles && !this.settings.usePluginSync) return;
        if (!this.settings.watchInternalFileChanges) return;
        if (path.endsWith("/")) {
            // Folder
            return;
        }
        const insensitive = isCaseInsensitiveSelection(this.settings, this.vaultService);
        if (!pathWithinConfigDirectory(path, this.core.services.API.getSystemConfigDir(), insensitive)) return;
        const isTargetFile = await this.vaultService.isTargetFileInExtra(path);
        if (!isTargetFile) return;

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
