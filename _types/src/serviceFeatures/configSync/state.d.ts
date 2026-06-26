// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
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
    conflictResolutionProcessor: QueueProcessor<any, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    loadedManifest_mTime: Map<string, number>;
    updatingV2Count: number;
    updatePluginListV2Task: (() => void) | undefined;
    pluginScanProcessor: QueueProcessor<any, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    pluginScanProcessorV2: QueueProcessor<any, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    recentProcessedInternalFiles: string[];
}
/**
 * Creates and initialises a new configuration synchronisation state object
 * with default values.
 *
 * @returns A freshly initialised {@link ConfigSyncState} object.
 */
export declare function createConfigSyncState(): ConfigSyncState;
