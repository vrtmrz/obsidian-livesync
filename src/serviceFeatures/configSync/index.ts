import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import { scheduleTask } from "@/common/utils.ts";

import type { ConfigSyncServices, ConfigSyncModules } from "./types.ts";
import { createConfigSyncState } from "./state.ts";
import { bindConfigSyncEvents } from "./eventBindings.ts";
import { registerConfigSyncCommands } from "./commands.ts";
import { createPluginScanProcessor, createPluginScanProcessorV2 } from "./pluginScanner.ts";
import { scanAllConfigFiles, watchVaultRawEventsAsync } from "./syncOperations.ts";
import { pluginList } from "./stores.ts";
import { PluginDialogModal } from "@/features/ConfigSync/PluginDialogModal.ts";

/**
 * A service feature hook that initialises and manages the configuration synchronisation module.
 * This sets up the scanning processors, watches for local/remote config changes, and binds UI dialogues.
 */
export const useConfigSync = createObsidianServiceFeature<
    ConfigSyncServices,
    ConfigSyncModules,
    "app" | "plugin" | "liveSyncPlugin"
>((host) => {
    const log = createInstanceLogFunction("ConfigSync", host.services.API);
    const state = createConfigSyncState();

    // Setup update notification task
    state.updatePluginListV2Task = () => {
        scheduleTask("updatePluginListV2", 100, () => {
            pluginList.set(state.pluginList);
        });
    };

    // Modal dialog hooks
    const showPluginSyncModal = () => {
        const settings = host.services.setting.currentSettings();
        if (!settings.usePluginSync) {
            return;
        }
        if (state.pluginDialog) {
            state.pluginDialog.open();
        } else {
            state.pluginDialog = new PluginDialogModal(host.context.app, host.context.liveSyncPlugin);
            state.pluginDialog.open();
        }
    };

    // Bind events
    bindConfigSyncEvents(host, log, state, {
        showPluginSyncModal,
        watchVaultRawEventsAsync: async (path) => {
            return await watchVaultRawEventsAsync(host, log, state, path);
        },
    });

    // Register commands
    registerConfigSyncCommands(host, {
        showPluginSyncModal,
    });

    // Initialise processors
    state.periodicPluginSweepProcessor = new PeriodicProcessor(host, async () => {
        await scanAllConfigFiles(host, log, state, false);
    });

    state.pluginScanProcessor = createPluginScanProcessor(host, log, state);
    state.pluginScanProcessorV2 = createPluginScanProcessorV2(host, log, state);
});
