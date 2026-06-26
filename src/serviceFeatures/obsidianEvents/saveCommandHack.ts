import { LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { fireAndForget } from "octagonal-wheels/promises";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { ObsidianEventsHost } from "./types.ts";
import type { ObsidianEventsState } from "./state.ts";

/**
 * Swaps the default Obsidian save command callback to trigger a synchronisation sweep.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export function swapSaveCommand(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void {
    log("Modifying callback of the save command", LOG_LEVEL_VERBOSE);
    const appAny = (host as any).app;
    const saveCommandDefinition = appAny?.commands?.commands?.["editor:save-file"];
    const save = saveCommandDefinition?.callback;
    if (typeof save === "function") {
        state.initialCallback = save;
        saveCommandDefinition.callback = () => {
            scheduleTask("syncOnEditorSave", 250, () => {
                if (host.services.control.hasUnloaded()) {
                    log("Unload and remove the handler.", LOG_LEVEL_VERBOSE);
                    saveCommandDefinition.callback = state.initialCallback;
                    state.initialCallback = undefined;
                } else {
                    const settings = host.services.setting.currentSettings();
                    if (settings.syncOnEditorSave) {
                        log("Sync on Editor Save.", LOG_LEVEL_VERBOSE);
                        fireAndForget(() => host.services.replication.replicateByEvent());
                    }
                }
            });
            save();
        };
    }

    if (!(compatGlobal as any).CodeMirrorAdapter) {
        log("CodeMirrorAdapter is not available", LOG_LEVEL_VERBOSE);
        return;
    }
    (compatGlobal as any).CodeMirrorAdapter.commands.save = () => {
        if (appAny?.commands) {
            void appAny.commands.executeCommandById("editor:save-file");
        }
    };
}
