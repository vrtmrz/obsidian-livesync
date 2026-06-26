import { EVENT_SETTING_SAVED, eventHub } from "@/common/events.ts";
import { isInternalMetadata } from "@/common/utils.ts";
import type { FilePath, FilePathWithPrefix, LoadedEntry } from "@lib/common/types.ts";
import type { LogFunction } from "@lib/services/lib/logUtils";
import { LOG_LEVEL_VERBOSE } from "@lib/common/types.ts";
import type { HiddenFileSyncHost } from "./types.ts";
import type { HiddenFileSyncState } from "./state.ts";

export function bindHiddenFileSyncEvents(
    host: HiddenFileSyncHost,
    log: LogFunction,
    state: HiddenFileSyncState,
    handlers: {
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
        askUsingOptionalSyncFeature: (opt: { enableFetch?: boolean; enableOverwrite?: boolean }) => Promise<boolean>;
        configureOptionalSyncFeature: (feature: keyof OPTIONAL_SYNC_FEATURES) => Promise<boolean>;
        isTargetFile: (path: FilePath) => Promise<boolean>;
    }
) {
    // Setting saved
    eventHub.onEvent(EVENT_SETTING_SAVED, () => {
        handlers.updateSettingCache();
    });

    // Database initialized
    host.services.databaseEvents.onDatabaseInitialised.addHandler(async (showNotice: boolean) => {
        // Initialization of cache done inside the handler
        if (handlers.isThisModuleEnabled()) {
            if (state._fileInfoLastProcessed.size === 0 && state._databaseInfoLastProcessed.size === 0) {
                log(`No cache found. Performing startup scan.`, LOG_LEVEL_VERBOSE);
                await handlers.performStartupScan(true);
            } else {
                await handlers.performStartupScan(showNotice);
            }
        }
        return true;
    });

    // Before replicate
    host.services.replication.onBeforeReplicate.addHandler(async (showNotice: boolean) => {
        if (
            handlers.isThisModuleEnabled() &&
            handlers.isDatabaseReady() &&
            host.services.setting.currentSettings().syncInternalFilesBeforeReplication &&
            !host.services.setting.currentSettings().watchInternalFileChanges
        ) {
            await handlers.scanAllStorageChanges(showNotice);
        }
        return true;
    });

    // App resume
    host.services.appLifecycle.onResuming.addHandler(async () => {
        state.periodicInternalFileScanProcessor?.disable();
        if (host.services.appLifecycle.isSuspended()) return true;
        if (handlers.isThisModuleEnabled()) {
            await handlers.performStartupScan(false);
        }
        const settings = host.services.setting.currentSettings();
        state.periodicInternalFileScanProcessor?.enable(
            handlers.isThisModuleEnabled() && settings.syncInternalFilesInterval
                ? settings.syncInternalFilesInterval * 1000
                : 0
        );
        return true;
    });

    // Sync mode change
    host.services.setting.onRealiseSetting.addHandler(() => {
        state.periodicInternalFileScanProcessor?.disable();
        if (host.services.appLifecycle.isSuspended()) return Promise.resolve(true);
        if (!host.services.appLifecycle.isReady()) return Promise.resolve(true);

        const settings = host.services.setting.currentSettings();
        state.periodicInternalFileScanProcessor?.enable(
            handlers.isThisModuleEnabled() && settings.syncInternalFilesInterval
                ? settings.syncInternalFilesInterval * 1000
                : 0
        );
        state.cacheFileRegExps.clear();
        return Promise.resolve(true);
    });

    // Process file event
    host.services.fileProcessing.processOptionalFileEvent.addHandler(async (path: FilePath) => {
        if (handlers.isReady()) {
            return (await handlers.trackStorageFileModification(path)) || false;
        }
        return false;
    });

    // Get conflict check method
    host.services.conflict.getOptionalConflictCheckMethod.addHandler((path: FilePathWithPrefix) => {
        if (isInternalMetadata(path)) {
            handlers.queueConflictCheck(path);
            return Promise.resolve(true);
        }
        return Promise.resolve(false);
    });

    // Process sync files
    host.services.replication.processOptionalSynchroniseResult.addHandler(async (doc: LoadedEntry) => {
        if (isInternalMetadata(doc._id)) {
            if (handlers.isThisModuleEnabled()) {
                return await handlers.processOptionalSyncFiles(doc);
            }
            return true; // if not enabled, skip processing
        }
        return false;
    });

    // Settings
    host.services.setting.suspendExtraSync.addHandler(handlers.suspendExtraSync);
    host.services.setting.suggestOptionalFeatures.addHandler(handlers.askUsingOptionalSyncFeature);
    host.services.setting.enableOptionalFeature.addHandler(handlers.configureOptionalSyncFeature);

    // Vault
    host.services.vault.isTargetFileInExtra.addHandler(handlers.isTargetFile);
}
