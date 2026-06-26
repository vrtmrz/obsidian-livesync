import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { fireAndForget } from "octagonal-wheels/promises";
import { compatGlobal } from "@lib/common/coreEnvFunctions.ts";
import type { TFile } from "@/deps.ts";
import type { FilePathWithPrefix } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils.ts";
import type { ObsidianEventsHost } from "./types.ts";
import type { ObsidianEventsState } from "./state.ts";

/**
 * Sets the focus status and triggers visibility check scheduling.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 * @param hasFocus - The new focus status.
 */
export function setHasFocus(
    host: ObsidianEventsHost,
    log: LogFunction,
    state: ObsidianEventsState,
    hasFocus: boolean
): void {
    state.hasFocus = hasFocus;
    watchWindowVisibility(host, log, state);
}

/**
 * Schedules a task to check and apply window visibility transitions.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export function watchWindowVisibility(host: ObsidianEventsHost, log: LogFunction, state: ObsidianEventsState): void {
    scheduleTask("watch-window-visibility", 100, () =>
        fireAndForget(() => watchWindowVisibilityAsync(host, log, state))
    );
}

/**
 * Asynchronously processes window visibility transitions, suspending or resuming replication channels.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param state - The runtime state of the Obsidian events module.
 */
export async function watchWindowVisibilityAsync(
    host: ObsidianEventsHost,
    log: LogFunction,
    state: ObsidianEventsState
): Promise<void> {
    const settings = host.services.setting.currentSettings();
    if (settings.suspendFileWatching) return;
    if (!settings.isConfigured) return;
    if (!host.services.appLifecycle.isReady()) return;

    if (state.isLastHidden && !state.hasFocus) {
        return;
    }

    const currentDoc = typeof activeDocument !== "undefined" ? activeDocument : (compatGlobal as any).document;
    const isHidden = currentDoc ? currentDoc.hidden : false;
    if (state.isLastHidden === isHidden) {
        return;
    }
    state.isLastHidden = isHidden;

    await host.services.fileProcessing.commitPendingFileEvents();

    const keepActiveInBackground =
        settings.keepReplicationActiveInBackground &&
        (settings.liveSync || settings.periodicReplication) &&
        !host.services.API.isMobile();

    if (isHidden) {
        if (!keepActiveInBackground) {
            await host.services.appLifecycle.onSuspending();
        }
    } else {
        if (host.services.appLifecycle.isSuspended()) return;
        if (keepActiveInBackground && settings.liveSync) {
            await host.services.appLifecycle.onSuspending();
        }
        await host.services.appLifecycle.onResuming();
        await host.services.appLifecycle.onResumed();
    }
}

/**
 * Schedules a task to check online recovery and vault rescanning.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 */
export function watchOnline(host: ObsidianEventsHost, log: LogFunction): void {
    scheduleTask("watch-online", 500, () => fireAndForget(() => watchOnlineAsync(host)));
}

/**
 * Asynchronously checks if online recovery is required, performing a vault scan if the network recovers.
 *
 * @param host - The service container host.
 */
export async function watchOnlineAsync(host: ObsidianEventsHost): Promise<void> {
    const localDb = host.services.database.localDatabase;
    if (compatGlobal.navigator.onLine && localDb.needScanning) {
        localDb.needScanning = false;
        await host.services.vault.scanVault();
    }
}

/**
 * Schedules a task to process files opened in the workspace.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param file - The file that was opened.
 */
export function watchWorkspaceOpen(host: ObsidianEventsHost, log: LogFunction, file: TFile | null): void {
    const settings = host.services.setting.currentSettings();
    if (settings.suspendFileWatching) return;
    if (!settings.isConfigured) return;
    if (!host.services.appLifecycle.isReady()) return;
    if (!file) return;
    scheduleTask("watch-workspace-open", 500, () => fireAndForget(() => watchWorkspaceOpenAsync(host, log, file)));
}

/**
 * Asynchronously handles workspace file open events, running replication and checking for conflicts.
 *
 * @param host - The service container host.
 * @param log - The logger function.
 * @param file - The file that was opened.
 */
export async function watchWorkspaceOpenAsync(host: ObsidianEventsHost, log: LogFunction, file: TFile): Promise<void> {
    const settings = host.services.setting.currentSettings();
    if (settings.suspendFileWatching) return;
    if (!settings.isConfigured) return;
    if (!host.services.appLifecycle.isReady()) return;

    await host.services.fileProcessing.commitPendingFileEvents();
    if (file == null) {
        return;
    }
    if (settings.syncOnFileOpen && !host.services.appLifecycle.isSuspended()) {
        await host.services.replication.replicateByEvent();
    }
    await host.services.conflict.queueCheckForIfOpen(file.path as FilePathWithPrefix);
}
