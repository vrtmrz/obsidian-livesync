import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import type { PluginDialogModal } from "@/features/ConfigSync/PluginDialogModal.ts";
import type { IPluginDataExDisplay } from "./types.ts";

/**
 * Represents the runtime state of the configuration synchronisation feature.
 * This state is scoped to the feature lifecycle, containing active processors,
 * cached metadata, and UI dialogues.
 */
export interface ConfigSyncState {
    pluginList: IPluginDataExDisplay[];
    pluginDialog: PluginDialogModal | undefined;
    periodicPluginSweepProcessor: PeriodicProcessor | undefined;
    conflictResolutionProcessor: QueueProcessor<any, any> | undefined;
    loadedManifest_mTime: Map<string, number>;
    updatingV2Count: number;
    updatePluginListV2Task: (() => void) | undefined;
    pluginScanProcessor: QueueProcessor<any, any> | undefined;
    pluginScanProcessorV2: QueueProcessor<any, any> | undefined;
    recentProcessedInternalFiles: string[];
}

/**
 * Creates and initialises a new configuration synchronisation state object
 * with default values.
 *
 * @returns A freshly initialised {@link ConfigSyncState} object.
 */
export function createConfigSyncState(): ConfigSyncState {
    return {
        pluginList: [],
        pluginDialog: undefined,
        periodicPluginSweepProcessor: undefined,
        conflictResolutionProcessor: undefined,
        loadedManifest_mTime: new Map<string, number>(),
        updatingV2Count: 0,
        updatePluginListV2Task: undefined,
        pluginScanProcessor: undefined,
        pluginScanProcessorV2: undefined,
        recentProcessedInternalFiles: [],
    };
}
