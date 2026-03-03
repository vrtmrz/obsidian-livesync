import { HiddenFileSync } from "@/features/HiddenFileSync/CmdHiddenFileSync";
import type { FilePath } from "@lib/common/types";
import type ObsidianLiveSyncPlugin from "@/main";
import type { LiveSyncCore } from "@/main";
import { StorageEventManagerBase, type StorageEventManagerBaseDependencies } from "@lib/managers/StorageEventManager";
import { ObsidianStorageEventManagerAdapter } from "./ObsidianStorageEventManagerAdapter";

export class StorageEventManagerObsidian extends StorageEventManagerBase<ObsidianStorageEventManagerAdapter> {
    plugin: ObsidianLiveSyncPlugin;
    core: LiveSyncCore;

    // Necessary evil.
    cmdHiddenFileSync: HiddenFileSync;

    constructor(plugin: ObsidianLiveSyncPlugin, core: LiveSyncCore, dependencies: StorageEventManagerBaseDependencies) {
        const adapter = new ObsidianStorageEventManagerAdapter(plugin, core, dependencies.fileProcessing);
        super(adapter, dependencies);
        this.plugin = plugin;
        this.core = core;
        this.cmdHiddenFileSync = this.plugin.getAddOn(HiddenFileSync.name) as HiddenFileSync;
    }

    /**
     * Override _watchVaultRawEvents to add Obsidian-specific logic
     */
    protected override async _watchVaultRawEvents(path: FilePath) {
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
                    file: this.adapter.converter.toInternalFileInfo(path),
                    skipBatchWait: true, // Internal files should be processed immediately.
                },
            ],
            null
        );
    }
}
