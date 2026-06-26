// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 0563f26
import type { FilePath, FilePathWithPrefix, LoadedEntry } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";
export declare function bindHiddenFileSyncEvents(host: HiddenFileSyncHost, log: LogFunction, state: HiddenFileSyncState, handlers: {
    updateSettingCache: () => void;
    isThisModuleEnabled: () => boolean;
    isDatabaseReady: () => boolean;
    isReady: () => boolean;
    scanAllStorageChanges: (showNotice: boolean) => Promise<boolean>;
    performStartupScan: (showNotice: boolean) => Promise<void>;
    trackStorageFileModification: (path: FilePath) => Promise<boolean>;
    queueConflictCheck: (path: FilePathWithPrefix) => void;
    processOptionalSyncFiles: (doc: LoadedEntry) => Promise<boolean>;
    suspendExtraSync: () => Promise<boolean>;
    askUsingOptionalSyncFeature: (opt: {
        enableFetch?: boolean;
        enableOverwrite?: boolean;
    }) => Promise<boolean>;
    configureOptionalSyncFeature: (feature: keyof OPTIONAL_SYNC_FEATURES) => Promise<boolean>;
    isTargetFile: (path: FilePath) => Promise<boolean>;
}): void;
