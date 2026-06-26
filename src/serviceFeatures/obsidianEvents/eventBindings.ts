import { EVENT_FILE_RENAMED, EVENT_LEAF_ACTIVE_CHANGED, eventHub } from "@/common/events.ts";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import type { FilePathWithPrefix } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";

import { askReload, isReloadingScheduled, scheduleAppReload } from "./appReload.ts";
import { swapSaveCommand } from "./saveCommandHack.ts";
import type { ObsidianEventsState } from "./state.ts";
import type { ObsidianEventsHost } from "./types.ts";
import { setHasFocus, watchOnline, watchWindowVisibility, watchWorkspaceOpen } from "./windowVisibility.ts";

export function registerVaultAndWorkspaceEvents(host: ObsidianEventsHost): Promise<boolean> {
    const plugin = host.context.plugin;
    const app = host.context.app;
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
}

export function registerWindowWatchEvents(
    host: ObsidianEventsHost,
    log: LogFunction,
    state: ObsidianEventsState
): void {
    const plugin = host.context.plugin;
    const app = host.context.app;
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
}

export function onObsidianEventsLayoutReady(
    host: ObsidianEventsHost,
    log: LogFunction,
    state: ObsidianEventsState
): Promise<boolean> {
    swapSaveCommand(host, log, state);
    registerWindowWatchEvents(host, log, state);
    return Promise.resolve(true);
}

export function bindObsidianEventsLifecycle(
    host: ObsidianEventsHost,
    log: LogFunction,
    state: ObsidianEventsState
): void {
    host.services.appLifecycle.onLayoutReady.addHandler(() => onObsidianEventsLayoutReady(host, log, state));
    host.services.appLifecycle.onInitialise.addHandler(() => registerVaultAndWorkspaceEvents(host));

    host.services.appLifecycle.askRestart.setHandler((message?: string) => askReload(host, log, message));
    host.services.appLifecycle.scheduleRestart.setHandler(() => scheduleAppReload(host, log, state));
    host.services.appLifecycle.isReloadingScheduled.setHandler(() => isReloadingScheduled(state));
}
