import { createServiceFeature } from "@lib/interfaces/ServiceModule";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import { EVENT_FILE_RENAMED, EVENT_LEAF_ACTIVE_CHANGED, eventHub } from "@/common/events.ts";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import type { FilePathWithPrefix } from "@lib/common/types.ts";

import type { ObsidianEventsServices, ObsidianEventsModules } from "./types.ts";
import { createObsidianEventsState } from "./state.ts";
import { askReload, scheduleAppReload, isReloadingScheduled } from "./appReload.ts";
import { swapSaveCommand } from "./saveCommandHack.ts";
import { watchWindowVisibility, watchOnline, watchWorkspaceOpen, setHasFocus } from "./windowVisibility.ts";

/**
 * A service feature hook that initialises and manages Obsidian application event bindings.
 * This hooks into vault file changes, window focus, visibility states, and schedules restarts.
 */
export const useObsidianEvents = createServiceFeature<ObsidianEventsServices, ObsidianEventsModules, void>((host) => {
    const log = createInstanceLogFunction("ObsidianEvents", host.services.API);
    const state = createObsidianEventsState();
    const plugin = (host as any).plugin;
    const app = (host as any).app;

    const everyOnloadStart = (): Promise<boolean> => {
        if (plugin && app) {
            plugin.registerEvent(
                app.vault.on("rename", (file: any, oldPath: string) => {
                    eventHub.emitEvent(EVENT_FILE_RENAMED, {
                        newPath: file.path as FilePathWithPrefix,
                        old: oldPath as FilePathWithPrefix,
                    });
                })
            );
            plugin.registerEvent(
                app.workspace.on("active-leaf-change", () => eventHub.emitEvent(EVENT_LEAF_ACTIVE_CHANGED))
            );
        }
        return Promise.resolve(true);
    };

    const registerWatchEvents = (): void => {
        if (plugin && app) {
            const currentDoc = typeof activeDocument !== "undefined" ? activeDocument : (compatGlobal as any).document;

            plugin.registerEvent(app.workspace.on("file-open", (file: any) => watchWorkspaceOpen(host, log, file)));

            if (currentDoc) {
                plugin.registerDomEvent(currentDoc, "visibilitychange", () => watchWindowVisibility(host, log, state));
            }

            plugin.registerDomEvent(compatGlobal, "focus", () => setHasFocus(host, log, state, true));
            plugin.registerDomEvent(compatGlobal, "blur", () => setHasFocus(host, log, state, false));
            plugin.registerDomEvent(compatGlobal, "online", () => watchOnline(host, log));
            plugin.registerDomEvent(compatGlobal, "offline", () => watchOnline(host, log));
        }
    };

    const everyOnLayoutReady = (): Promise<boolean> => {
        swapSaveCommand(host, log, state);
        registerWatchEvents();
        return Promise.resolve(true);
    };

    // Bind event handlers onto the appLifecycle service
    host.services.appLifecycle.onLayoutReady.addHandler(everyOnLayoutReady);
    host.services.appLifecycle.onInitialise.addHandler(everyOnloadStart);

    (host.services.appLifecycle as any).askRestart.setHandler((message?: string) => askReload(host, log, message));
    (host.services.appLifecycle as any).scheduleRestart.setHandler(() => scheduleAppReload(host, log, state));
    (host.services.appLifecycle as any).isReloadingScheduled.setHandler(() => isReloadingScheduled(state));
});
