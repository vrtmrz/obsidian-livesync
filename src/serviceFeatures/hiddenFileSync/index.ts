import { createObsidianServiceFeature } from "@/types.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils";
import { PeriodicProcessor } from "@/common/PeriodicProcessor.ts";

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

import { queueConflictCheck, createConflictResolutionProcessor } from "./conflictResolution.ts";

export const useHiddenFileSync = createObsidianServiceFeature<HiddenFileSyncServices, HiddenFileSyncModules, "app">(
    (host) => {
        const log = createInstanceLogFunction("HiddenFileSync", host.services.API);
        const state = createHiddenFileSyncState();

        // Wire events
        bindHiddenFileSyncEvents(host, log, state, {
            updateSettingCache: () => updateSettingCache(host, state),
            isThisModuleEnabled: () => isThisModuleEnabled(host),
            isDatabaseReady: () => isDatabaseReady(host),
            isReady: () => isReady(host, state),
            scanAllStorageChanges: async (showNotice: boolean) => {
                return await scanAllStorageChanges(host, log, state, showNotice);
            },
            performStartupScan: async (showNotice: boolean) => {
                await performStartupScan(host, log, state, showNotice, async (sn) => {
                    await applyOfflineChanges(host, log, state, sn);
                });
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
            },
            scanAllStorageChanges: async (showNotice) => {
                return await scanAllStorageChanges(host, log, state, showNotice);
            },
            scanAllDatabaseChanges: async (showNotice) => {
                return await scanAllDatabaseChanges(host, log, state, showNotice);
            },
            applyOfflineChanges: async (showNotice) => {
                await applyOfflineChanges(host, log, state, showNotice);
            },
        });

        state.periodicInternalFileScanProcessor = new PeriodicProcessor(
            {
                settings: host.services.setting.currentSettings(),
                storageAccess: host.serviceModules.storageAccess,
                confirm: host.services.API.confirm,
                services: host.services,
                localDatabase: host.services.database.localDatabase,
                kvDB: host.services.keyValueDB.kvDB,
            } as any,
            async () =>
                isThisModuleEnabled(host) &&
                isDatabaseReady(host) &&
                (await scanAllStorageChanges(host, log, state, false))
        );

        state.conflictResolutionProcessor = createConflictResolutionProcessor(host, log, state);
    }
);
