import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";
import { autosaveCache } from "@/common/utils.ts";

import type { HiddenFileSyncModules, HiddenFileSyncServices } from "./types.ts";
import { createHiddenFileSyncState } from "./state.ts";

import { bindHiddenFileSyncEvents } from "./eventBindings.ts";
import { registerHiddenFileSyncCommands } from "./commands.ts";
import {
    isThisModuleEnabled,
    isDatabaseReady,
    isReady,
    updateSettingCache,
    performStartupScan,
} from "./startupScan.ts";

import {
    scanAllStorageChanges,
    trackStorageFileModification,
    processOptionalSyncFiles,
    suspendExtraSync,
    askUsingOptionalSyncFeature,
    configureOptionalSyncFeature,
    isTargetFile,
    scanAllDatabaseChanges,
    applyOfflineChanges,
} from "./syncOperations.ts";

import { initialiseInternalFileSync } from "./rebuild.ts";

import {
    queueConflictCheck,
    createConflictResolutionProcessor,
    resolveConflictOnInternalFiles,
} from "./conflictResolution.ts";

export const useHiddenFileSync = createObsidianServiceFeature<HiddenFileSyncServices, HiddenFileSyncModules, "app">(
    (host) => {
        const log = createInstanceLogFunction("HiddenFileSync", host.services.API);
        const state = createHiddenFileSyncState();

        const flushPersistentCaches = async () => {
            await Promise.all([
                state._fileInfoLastProcessed.flush?.(),
                state._databaseInfoLastProcessed.flush?.(),
                state._fileInfoLastKnown.flush?.(),
            ]);
        };

        const ensurePeriodicInternalFileScanProcessor = () => {
            if (state.periodicInternalFileScanProcessor) return;
            const localDatabase = host.services.database.localDatabaseDirect;
            if (!localDatabase) return;
            state.periodicInternalFileScanProcessor = new PeriodicProcessor(
                {
                    settings: host.services.setting.currentSettings(),
                    storageAccess: host.serviceModules.storageAccess,
                    confirm: host.services.API.confirm,
                    services: host.services,
                    localDatabase,
                    kvDB: host.services.keyValueDB.kvDB,
                } as any,
                async () =>
                    isThisModuleEnabled(host) &&
                    isDatabaseReady(host) &&
                    (await scanAllStorageChanges(host, log, state, false))
            );
        };

        host.services.databaseEvents.onDatabaseInitialised.addHandler(async () => {
            state._fileInfoLastProcessed = await autosaveCache(host.services.keyValueDB.kvDB, "hidden-file-lastProcessed");
            state._databaseInfoLastProcessed = await autosaveCache(
                host.services.keyValueDB.kvDB,
                "hidden-file-lastProcessed-database"
            );
            state._fileInfoLastKnown = await autosaveCache(host.services.keyValueDB.kvDB, "hidden-file-lastKnown");
            ensurePeriodicInternalFileScanProcessor();
            return true;
        });

        // Wire events
        bindHiddenFileSyncEvents(host, log, state, {
            updateSettingCache: () => updateSettingCache(host, state),
            isThisModuleEnabled: () => isThisModuleEnabled(host),
            isDatabaseReady: () => isDatabaseReady(host),
            isReady: () => isReady(host, state),
            scanAllStorageChanges: async (showNotice: boolean) => {
                const result = await scanAllStorageChanges(host, log, state, showNotice);
                await flushPersistentCaches();
                return result;
            },
            performStartupScan: async (showNotice: boolean) => {
                await performStartupScan(host, log, state, showNotice, async (sn) => {
                    await applyOfflineChanges(host, log, state, sn);
                });
                await flushPersistentCaches();
            },
            trackStorageFileModification: async (path) => {
                return (await trackStorageFileModification(host, log, state, path)) || false;
            },
            queueConflictCheck: (path) => {
                queueConflictCheck(host, state, path);
            },
            processOptionalSyncFiles: async (doc) => {
                return await processOptionalSyncFiles(host, log, state, doc);
            },
            suspendExtraSync: async () => {
                return await suspendExtraSync(host, state);
            },
            askUsingOptionalSyncFeature: async (opt) => {
                return await askUsingOptionalSyncFeature(host, log, state, opt);
            },
            configureOptionalSyncFeature: async (feature) => {
                return await configureOptionalSyncFeature(host, log, state, feature);
            },
            isTargetFile: async (path) => {
                return await isTargetFile(host, log, state, path);
            },
        });

        // Wire commands
        registerHiddenFileSyncCommands(host, {
            isReady: () => isReady(host, state),
            initialiseInternalFileSync: async (mode, showNotice) => {
                await initialiseInternalFileSync(host, log, state, mode, showNotice);
                await flushPersistentCaches();
            },
            scanAllStorageChanges: async (showNotice) => {
                const result = await scanAllStorageChanges(host, log, state, showNotice);
                await flushPersistentCaches();
                return result;
            },
            scanAllDatabaseChanges: async (showNotice) => {
                const result = await scanAllDatabaseChanges(host, log, state, showNotice);
                await flushPersistentCaches();
                return result;
            },
            applyOfflineChanges: async (showNotice) => {
                await applyOfflineChanges(host, log, state, showNotice);
                await flushPersistentCaches();
            },
            resolveConflicts: async () => {
                await resolveConflictOnInternalFiles(host, log, state);
                await scanAllDatabaseChanges(host, log, state, true);
                await flushPersistentCaches();
            },
        });

        host.services.appLifecycle.onBeforeUnload.addHandler(async () => {
            await flushPersistentCaches();
            return true;
        });
        host.services.appLifecycle.onUnload.addHandler(async () => {
            await flushPersistentCaches();
            return true;
        });
        host.services.appLifecycle.onSuspending.addHandler(async () => {
            await flushPersistentCaches();
            return true;
        });

        state.conflictResolutionProcessor = createConflictResolutionProcessor(host, log, state);
    }
);
