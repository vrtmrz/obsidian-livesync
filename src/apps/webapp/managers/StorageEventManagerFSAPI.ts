import { StorageEventManagerBase, type StorageEventManagerBaseDependencies } from "@lib/managers/StorageEventManager";
import { FSAPIStorageEventManagerAdapter } from "./FSAPIStorageEventManagerAdapter";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@lib/services/base/ServiceBase";

export class StorageEventManagerFSAPI extends StorageEventManagerBase<FSAPIStorageEventManagerAdapter> {
    core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>;
    private fsapiAdapter: FSAPIStorageEventManagerAdapter;

    constructor(
        rootHandle: FileSystemDirectoryHandle,
        core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>,
        dependencies: StorageEventManagerBaseDependencies
    ) {
        const adapter = new FSAPIStorageEventManagerAdapter(rootHandle);
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
            await (this.fsapiAdapter.watch as any).stopWatch?.();
        }
    }
}
