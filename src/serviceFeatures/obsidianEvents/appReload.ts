import { LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import { reactive, reactiveSource } from "octagonal-wheels/dataobject/reactive";
import {
    collectingChunks,
    pluginScanningCount,
    hiddenFilesEventCount,
    hiddenFilesProcessingCount,
} from "@lib/mock_and_interop/stores.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { ObsidianEventsHost } from "./types.ts";
import type { ObsidianEventsState } from "./state.ts";

/**
 * Executes a restart and reload of the Obsidian application.
 *
 * @param host - The service container host.
 */
export function performAppReload(host: ObsidianEventsHost): void {
    host.services.appLifecycle.performRestart();
}

/**
 * Asks the user if they want to restart and reload Obsidian now, scheduling or executing it.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param message - An optional custom message to display in the dialogue.
 */
export function askReload(host: ObsidianEventsHost, log: LogFunction, message?: string): void {
    if (host.services.appLifecycle.isReloadingScheduled()) {
        log("Reloading is already scheduled", LOG_LEVEL_VERBOSE);
        return;
    }
    scheduleTask("configReload", 250, async () => {
        const RESTART_NOW = "Yes, restart immediately";
        const RESTART_AFTER_STABLE = "Yes, schedule a restart after stabilisation";
        const RETRY_LATER = "No, Leave it to me";
        const ret = await host.services.UI.confirm.askSelectStringDialogue(
            message || "Do you want to restart and reload Obsidian now?",
            [RESTART_AFTER_STABLE, RESTART_NOW, RETRY_LATER],
            { defaultAction: RETRY_LATER }
        );
        if (ret === RESTART_NOW) {
            performAppReload(host);
        } else if (ret === RESTART_AFTER_STABLE) {
            host.services.appLifecycle.scheduleRestart();
        }
    });
}

/**
 * Schedules an application reload, waiting for all background tasks to stabilise to 0.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export function scheduleAppReload(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void {
    if (!state.totalProcessingCount) {
        const tick = reactiveSource(0);
        state.totalProcessingCount = reactive(() => {
            const dbCount = host.services.replication.databaseQueueCount.value;
            const replicationCount = host.services.replication.replicationResultCount.value;
            const storageApplyingCount = host.services.replication.storageApplyingCount.value;
            const chunkCount = collectingChunks.value;
            const pluginScanCount = pluginScanningCount.value;
            const hiddenFilesCount = hiddenFilesEventCount.value + hiddenFilesProcessingCount.value;
            const conflictProcessCount = host.services.conflict.conflictProcessQueueCount.value;
            const e = 0;
            const proc = 0;
            const tickVal = tick.value;
            return (
                dbCount +
                replicationCount +
                storageApplyingCount +
                chunkCount +
                pluginScanCount +
                hiddenFilesCount +
                conflictProcessCount +
                e +
                proc +
                tickVal * 0
            );
        });

        const plugin = host.context.plugin;
        const intervalId = compatGlobal.setInterval(() => {
            tick.value++;
        }, 1000);

        if (plugin && typeof plugin.registerInterval === "function") {
            plugin.registerInterval(intervalId);
        }

        let stableCheck = 3;
        state.totalProcessingCount.onChanged((e) => {
            if (e.value === 0) {
                if (stableCheck-- <= 0) {
                    performAppReload(host);
                }
                log(
                    `Obsidian will be restarted soon! (Within ${stableCheck} seconds)`,
                    LOG_LEVEL_NOTICE,
                    "restart-notice"
                );
            } else {
                stableCheck = 3;
            }
        });
    }
}

/**
 * Checks if an application reload has already been scheduled.
 *
 * @param state - The runtime state of the Obsidian events module.
 * @returns True if scheduled, false otherwise.
 */
export function isReloadingScheduled(state: ObsidianEventsState): boolean {
    return state.totalProcessingCount !== undefined;
}
