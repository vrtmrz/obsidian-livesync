import { StorageEventManagerBase, type StorageEventManagerBaseDependencies } from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import { CLIStorageEventManagerAdapter } from "./CLIStorageEventManagerAdapter";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { IgnoreRules } from "@/apps/cli/serviceModules/IgnoreRules";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
// import type { IMinimumLiveSyncCommands } from "@vrtmrz/livesync-commonlib/compat/services/base/IService";

export class StorageEventManagerCLI extends StorageEventManagerBase<CLIStorageEventManagerAdapter> {
    core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>;

    constructor(
        basePath: string,
        core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>,
        dependencies: StorageEventManagerBaseDependencies,
        ignoreRules?: IgnoreRules,
        watchEnabled?: boolean
    ) {
        const adapter = new CLIStorageEventManagerAdapter(basePath, ignoreRules, watchEnabled, (message, detail) => {
            dependencies.APIService.addLog(message, LOG_LEVEL_NOTICE);
            if (detail !== undefined) {
                dependencies.APIService.addLog(detail, LOG_LEVEL_NOTICE);
            }
        });
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

    /**
     * Close the file watcher. Call this during graceful shutdown.
     */
    close(): Promise<void> {
        return this.adapter.close();
    }
}
