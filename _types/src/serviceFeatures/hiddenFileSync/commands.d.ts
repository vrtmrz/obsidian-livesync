// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { HiddenFileSyncHost } from "./types.ts";
export declare function registerHiddenFileSyncCommands(host: HiddenFileSyncHost, handlers: {
    isReady: () => boolean;
    initialiseInternalFileSync: (mode: "safe", showNotice: boolean) => Promise<void>;
    scanAllStorageChanges: (showNotice: boolean) => Promise<boolean>;
    scanAllDatabaseChanges: (showNotice: boolean) => Promise<boolean>;
    applyOfflineChanges: (showNotice: boolean) => Promise<void>;
    resolveConflicts: (showNotice: boolean) => Promise<void>;
}): void;
