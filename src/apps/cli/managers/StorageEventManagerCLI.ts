import { StorageEventManagerBase, type StorageEventManagerBaseDependencies } from "@lib/managers/StorageEventManager";
import { CLIStorageEventManagerAdapter } from "./CLIStorageEventManagerAdapter";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "../../../LiveSyncBaseCore";
import type { ServiceContext } from "@lib/services/base/ServiceBase";
// import type { IMinimumLiveSyncCommands } from "@lib/services/base/IService";

export class StorageEventManagerCLI extends StorageEventManagerBase<CLIStorageEventManagerAdapter> {
    core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>;

    constructor(
        basePath: string,
        core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>,
        dependencies: StorageEventManagerBaseDependencies
    ) {
        const adapter = new CLIStorageEventManagerAdapter(basePath);
        super(adapter, dependencies);
        this.core = core;
    }

    /**
     * Override _watchVaultRawEvents for CLI-specific logic
     * In CLI, we don't have internal files like Obsidian's .obsidian folder
     */
    protected override async _watchVaultRawEvents(path: string) {
        // No-op in CLI version
        // Internal file handling is not needed
    }
}
