import type { HiddenFileSyncHost } from "./types.ts";

export function registerHiddenFileSyncCommands(
    host: HiddenFileSyncHost,
    handlers: {
        isReady: () => boolean;
        initialiseInternalFileSync: (mode: "safe", showNotice: boolean) => Promise<void>;
        scanAllStorageChanges: (showNotice: boolean) => Promise<boolean>;
        scanAllDatabaseChanges: (showNotice: boolean) => Promise<boolean>;
        applyOfflineChanges: (showNotice: boolean) => Promise<void>;
    }
) {
    host.services.API.addCommand({
        id: "livesync-sync-internal",
        name: "(re)initialise hidden files between storage and database",
        callback: () => {
            if (handlers.isReady()) {
                void handlers.initialiseInternalFileSync("safe", true);
            }
        },
    });

    host.services.API.addCommand({
        id: "livesync-scaninternal-storage",
        name: "Scan hidden file changes on the storage",
        callback: () => {
            if (handlers.isReady()) {
                void handlers.scanAllStorageChanges(true);
            }
        },
    });

    host.services.API.addCommand({
        id: "livesync-scaninternal-database",
        name: "Scan hidden file changes on the local database",
        callback: () => {
            if (handlers.isReady()) {
                void handlers.scanAllDatabaseChanges(true);
            }
        },
    });

    host.services.API.addCommand({
        id: "livesync-internal-scan-offline-changes",
        name: "Scan and apply all offline hidden-file changes",
        callback: () => {
            if (handlers.isReady()) {
                void handlers.applyOfflineChanges(true);
            }
        },
    });
}
