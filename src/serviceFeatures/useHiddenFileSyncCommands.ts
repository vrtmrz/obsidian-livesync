import { EVENT_SETTING_SAVED, eventHub } from "@/common/events.ts";
import type { HiddenFileSyncCommandView } from "@/features/HiddenFileSync/hiddenFileSyncViews.ts";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";

export type HiddenFileSyncCommandHost = NecessaryServices<"API" | "appLifecycle", never>;

/** Register the Obsidian commands and event bridge for Hidden File Sync. */
export function useHiddenFileSyncCommands(
    host: HiddenFileSyncCommandHost,
    operations: HiddenFileSyncCommandView
): void {
    const { API, appLifecycle } = host.services;
    let registered = false;
    let disposed = false;
    let settingSavedDisposer: (() => void) | undefined;
    let loadedDisposer: (() => void) | undefined;
    let unloadDisposer: (() => void) | undefined;

    const checkAndRun = (checking: boolean, operation: () => void) => {
        if (!operations.isManualCommandAvailable()) return false;
        if (!checking) operation();
        return true;
    };

    const registerCommands = () => {
        if (registered || disposed) return Promise.resolve(true);
        registered = true;

        API.addCommand({
            id: "livesync-sync-internal",
            name: "(re)initialise hidden files between storage and database",
            checkCallback: (checking) =>
                checkAndRun(checking, () => void operations.initialiseInternalFileSync("safe", true)),
        });
        API.addCommand({
            id: "livesync-scaninternal-storage",
            name: "Scan hidden file changes on the storage",
            checkCallback: (checking) => checkAndRun(checking, () => void operations.scanAllStorageChanges(true)),
        });
        API.addCommand({
            id: "livesync-scaninternal-database",
            name: "Scan hidden file changes on the local database",
            checkCallback: (checking) => checkAndRun(checking, () => void operations.scanAllDatabaseChanges(true)),
        });
        API.addCommand({
            id: "livesync-internal-scan-offline-changes",
            name: "Scan and apply all offline hidden-file changes",
            checkCallback: (checking) => checkAndRun(checking, () => void operations.applyOfflineChanges(true)),
        });
        settingSavedDisposer = eventHub.onEvent(EVENT_SETTING_SAVED, () => operations.updateSettingCache());
        return Promise.resolve(true);
    };

    loadedDisposer = appLifecycle.onLoaded.addHandler(registerCommands);
    unloadDisposer = appLifecycle.onUnload.addHandler(() => {
        disposed = true;
        settingSavedDisposer?.();
        settingSavedDisposer = undefined;
        loadedDisposer?.();
        loadedDisposer = undefined;
        unloadDisposer?.();
        unloadDisposer = undefined;
        return Promise.resolve(true);
    });
}
