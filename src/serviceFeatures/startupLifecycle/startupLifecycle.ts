import { EVENT_REQUEST_RUN_DOCTOR, EVENT_REQUEST_RUN_FIX_INCOMPLETE, EVENT_SETTING_SAVED } from "@/common/events";
import { $msg } from "@/common/translation";
import { createInstanceLogFunction } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { LOG_LEVEL_NOTICE } from "@vrtmrz/livesync-commonlib/compat/common/logger";
import type {
    StartupLifecycleHost,
    StartupLifecycleFeatureOptions,
    ConfiguredStartupLifecycleOperations,
} from "./types";
import { runConfiguredStartupLifecycle, runStartupEntryLifecycle } from "./configuredStartupLifecycle";
import { runConfigDoctor } from "./configDoctor";
import { checkCompromisedChunks } from "./compromisedChunks";
import { checkIncompleteDocuments } from "./incompleteDocuments";
import { migrateBulkSendSetting } from "./bulkSettingMigration";

/** Layout admission runs after ordinary priority-0 host handlers. */
export const STARTUP_LIFECYCLE_LAYOUT_PRIORITY = 1 as const;

function readValue<T>(value: T | (() => T)): T {
    return typeof value === "function" ? (value as () => T)() : value;
}

function createDefaultOperations(
    host: StartupLifecycleHost,
    options: StartupLifecycleFeatureOptions,
    log: ReturnType<typeof createInstanceLogFunction>
): ConfiguredStartupLifecycleOperations {
    const { services } = host;
    return {
        databaseReady: options.databaseReady ?? (() => services.database.localDatabase.isReady),
        reportDatabaseNotReady:
            options.reportDatabaseNotReady ??
            (() => log($msg("moduleMigration.logLocalDatabaseNotReady"), LOG_LEVEL_NOTICE)),
        hasCompromisedChunks:
            options.hasCompromisedChunks ??
            (() =>
                checkCompromisedChunks({
                    settings: services.setting.currentSettings(),
                    localDatabase: services.database.localDatabase,
                    isOnline: () => services.API.isOnline,
                    getActiveReplicator: () => services.replicator.getActiveReplicator(),
                    confirm: services.UI.confirm,
                    rebuilder: host.serviceModules.rebuilder,
                    performRestart: () => services.appLifecycle.performRestart(),
                    log,
                })),
        hasIncompleteDocuments:
            options.hasIncompleteDocuments ??
            ((force = false) =>
                checkIncompleteDocuments(
                    {
                        localDatabase: services.database.localDatabase,
                        getPath: (entry) => services.path.getPath(entry),
                        isTargetFile: (path) => services.vault.isTargetFile(path),
                        storageAccess: host.serviceModules.storageAccess,
                        fileHandler: host.serviceModules.fileHandler,
                        keyValueDB: services.keyValueDB.kvDB,
                        noticeGroups: services.context.noticeGroups,
                        confirm: services.UI.confirm,
                        log,
                    },
                    force
                )),
        waitForCompatibilityReview: options.waitForCompatibilityReview,
        runDoctor:
            options.runDoctor ??
            ((skipRebuild = false, activateReason = "updated", forceRescan = false) =>
                runConfigDoctor(
                    {
                        confirm: services.UI.confirm,
                        translate: services.context.translate,
                        settings: services.setting.currentSettings(),
                        setSettings: (settings) => {
                            services.setting.settings = settings;
                        },
                        saveSettings: () => services.setting.saveSettingData(),
                        rebuilder: host.serviceModules.rebuilder,
                        performRestart: () => services.appLifecycle.performRestart(),
                    },
                    skipRebuild,
                    activateReason,
                    forceRescan
                )),
        migrateBulkSend:
            options.migrateBulkSend ??
            (() =>
                migrateBulkSendSetting({
                    settings: services.setting.currentSettings(),
                    log,
                    saveSettings: () => services.setting.saveSettingData(),
                })),
    };
}

/**
 * Compose configured Vault admission, start-up integrity checks, migrations,
 * and their request events around one host-owned service context.
 *
 * Event listeners are deliberately registered from the successful layout
 * admission handler. An unconfigured Vault therefore cannot receive a
 * Config Doctor or incomplete-document request before onboarding.
 */
export function useStartupLifecycleFeature(host: StartupLifecycleHost, options: StartupLifecycleFeatureOptions): void {
    const log = options.log ?? createInstanceLogFunction("SF:StartupLifecycle", host.services.API);
    const operations = createDefaultOperations(host, options, log);
    let layoutAdmitted = false;
    let layoutEvaluated = false;
    let generationRetired = false;
    let eventsBound = false;
    let eventUnsubscribers: Array<() => void> = [];

    const isConfigured = () => {
        const configured = options.configured;
        return configured === undefined
            ? host.services.setting.currentSettings().isConfigured === true
            : readValue(configured);
    };

    const isDatabaseReady = () => readValue(operations.databaseReady);

    const retireGeneration = () => {
        if (generationRetired) return;
        generationRetired = true;
        layoutAdmitted = false;
        for (const unsubscribe of eventUnsubscribers) unsubscribe();
        eventUnsubscribers = [];
    };

    const bindRequestEvents = () => {
        if (eventsBound || generationRetired) return;
        eventsBound = true;
        eventUnsubscribers = [
            host.services.context.events.onEvent(EVENT_REQUEST_RUN_DOCTOR, async (reason) => {
                if (!layoutAdmitted || generationRetired || !isConfigured() || !isDatabaseReady()) return;
                await operations.runDoctor(false, reason, true);
            }),
            host.services.context.events.onEvent(EVENT_REQUEST_RUN_FIX_INCOMPLETE, async () => {
                if (!layoutAdmitted || generationRetired || !isConfigured() || !isDatabaseReady()) return;
                await operations.hasIncompleteDocuments(true);
            }),
            host.services.context.events.onEvent(EVENT_SETTING_SAVED, (settings) => {
                if (settings.isConfigured !== true) retireGeneration();
            }),
        ];
    };

    const layoutAdmission = (): Promise<boolean> => {
        if (generationRetired) return Promise.resolve(false);
        if (layoutEvaluated) {
            if (layoutAdmitted && !isConfigured()) retireGeneration();
            return Promise.resolve(layoutAdmitted);
        }

        layoutEvaluated = true;
        const admitted = runStartupEntryLifecycle({
            configured: isConfigured,
            inviteToOnboarding: options.inviteToOnboarding,
        });
        if (!admitted) {
            retireGeneration();
            return Promise.resolve(false);
        }
        layoutAdmitted = true;
        bindRequestEvents();
        return Promise.resolve(true);
    };

    const firstInitialise = async (): Promise<boolean> => {
        if (!layoutAdmitted || generationRetired || !isConfigured()) return false;
        return await runConfiguredStartupLifecycle(operations);
    };

    host.services.appLifecycle.onLayoutReady.addHandler(layoutAdmission, STARTUP_LIFECYCLE_LAYOUT_PRIORITY);
    host.services.appLifecycle.onFirstInitialise.addHandler(firstInitialise);
}
