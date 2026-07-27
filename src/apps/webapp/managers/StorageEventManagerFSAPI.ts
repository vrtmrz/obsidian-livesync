import { StorageEventManagerBase, type StorageEventManagerBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import { FSAPIStorageEventManagerAdapter } from "./FSAPIStorageEventManagerAdapter";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";

export class StorageEventManagerFSAPI extends StorageEventManagerBase<FSAPIStorageEventManagerAdapter> {
    core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>;
    private fsapiAdapter: FSAPIStorageEventManagerAdapter;

    constructor(
        rootHandle: FileSystemDirectoryHandle,
        core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>,
        dependencies: StorageEventManagerBaseDependencies
    ) {
        const adapter = new FSAPIStorageEventManagerAdapter(rootHandle, (message, level, key) =>
            dependencies.APIService.addLog(message, level, key)
        );
        super(adapter, dependencies);
        this.fsapiAdapter = adapter;
        this.core = core;
    }

    /**
     * Override _watchVaultRawEvents for webapp-specific logic
     * In webapp, we don't have internal files like Obsidian's .obsidian folder
     */
    protected override async _watchVaultRawEvents(path: string) {
        // No-op in webapp version
        // Internal file handling is not needed
    }

    async cleanup() {
        // Stop file watching
        if (this.fsapiAdapter?.watch) {
            await this.fsapiAdapter.watch.stopWatch?.();
        }
    }
}
