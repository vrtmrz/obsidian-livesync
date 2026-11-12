import {
    StorageEventManagerBase,
    type StorageEventManagerBaseDependencies,
} from "@vrtmrz/livesync-commonlib/compat/managers/StorageEventManager";
import { CLIStorageEventManagerAdapter } from "./CLIStorageEventManagerAdapter";
import type { IMinimumLiveSyncCommands, LiveSyncBaseCore } from "@/LiveSyncBaseCore";
import type { ServiceContext } from "@vrtmrz/livesync-commonlib/context";
import type { CLIFileNameSource } from "@/apps/cli/storage/CLIFileNameSource";
import type { IgnoreRules } from "@/apps/cli/serviceModules/IgnoreRules";
import type { CLIPathFilterOptions } from "@/apps/cli/cliPathFilter";
import { LOG_LEVEL_NOTICE } from "octagonal-wheels/common/logger";
import { runtimeScopeDirectory } from "@/apps/cli/runtimeState";
import type { NodeServiceContext } from "@/apps/cli/services/NodeServiceContext";
import { path as nodePath } from "@vrtmrz/livesync-commonlib/node";

export class StorageEventManagerCLI extends StorageEventManagerBase<CLIStorageEventManagerAdapter> {
    core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>;

    constructor(
        basePath: string,
        core: LiveSyncBaseCore<ServiceContext, IMinimumLiveSyncCommands>,
        dependencies: StorageEventManagerBaseDependencies,
        ignoreRules?: IgnoreRules,
        watchEnabled?: boolean,
        pathFilterOptions?: CLIPathFilterOptions,
        nameSource?: CLIFileNameSource
    ) {
        const context = core.services.context as NodeServiceContext;
        const adapter = new CLIStorageEventManagerAdapter(
            basePath,
            ignoreRules,
            watchEnabled,
            (message, detail) => {
                dependencies.APIService.addLog(message, LOG_LEVEL_NOTICE);
                if (detail !== undefined) {
                    dependencies.APIService.addLog(detail, LOG_LEVEL_NOTICE);
                }
            },
            // Fetch/rebuild can change the selected suffix after construction; resolve
            // the snapshot location when used so it follows the current DB/Vault scope.
            () =>
                nodePath.join(
                    runtimeScopeDirectory(context.databasePath, dependencies.vaultService.getVaultName(), basePath),
                    "storage-events.json"
                ),
            pathFilterOptions,
            nameSource
        );
        super(adapter, dependencies);
        this.core = core;
    }

    /** The CLI uses shared exclusions instead of the plug-in's raw internal-file event processing. */
    protected override async _watchVaultRawEvents(path: string) {
        // Hidden and internal entries are intentionally not queued as raw Vault events.
    }

    /**
     * Close the file watcher. Call this during graceful shutdown.
     */
    close(): Promise<void> {
        return this.adapter.close();
    }
}
