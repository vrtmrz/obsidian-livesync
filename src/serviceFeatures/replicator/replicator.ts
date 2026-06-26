import { fireAndForget } from "octagonal-wheels/promises";
import { registerReplicatorCommands } from "./commands";
import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_INFO } from "octagonal-wheels/common/logger";
import { skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { balanceChunkPurgedDBs } from "@lib/pouchdb/chunks";
import { purgeUnreferencedChunks } from "@lib/pouchdb/chunks";
import { LiveSyncCouchDBReplicator } from "@lib/replication/couchdb/LiveSyncReplicator";
import { type EntryDoc } from "@lib/common/types";

import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { EVENT_FILE_SAVED, EVENT_SETTING_SAVED, eventHub } from "@/common/events";

import { $msg } from "@lib/common/i18n";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";
import { clearHandlers } from "@lib/replication/SyncParamsHandler";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { MARK_LOG_NETWORK_ERROR } from "@lib/services/lib/logUtils";
import type { NecessaryObsidianFeature } from "@/types";

function isOnlineAndCanReplicate(
    errorManager: UnresolvedErrorManager,
    host: NecessaryServices<"API", never>,
    showMessage: boolean
): Promise<boolean> {
    const errorMessage = "Network is offline";
    if (!host.services.API.isOnline) {
        errorManager.showError(errorMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return Promise.resolve(false);
    }
    errorManager.clearError(errorMessage);
    return Promise.resolve(true);
}

async function canReplicateWithPBKDF2(
    errorManager: UnresolvedErrorManager,
    host: NecessaryServices<"replicator" | "setting", never>,
    showMessage: boolean
): Promise<boolean> {
    const currentSettings = host.services.setting.currentSettings();
    const errorMessage = $msg("Replicator.Message.InitialiseFatalError");
    const replicator = host.services.replicator.getActiveReplicator();
    if (!replicator) {
        errorManager.showError(errorMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return false;
    }
    errorManager.clearError(errorMessage);
    const ensureMessage = `${MARK_LOG_NETWORK_ERROR}Failed to initialise the encryption key, preventing replication.`;
    const ensureResult = await replicator.ensurePBKDF2Salt(currentSettings, showMessage, true);
    if (!ensureResult) {
        errorManager.showError(ensureMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return false;
    }
    errorManager.clearError(ensureMessage);
    return ensureResult;
}

export type ReplicatorHost = NecessaryObsidianFeature<
    | "appLifecycle"
    | "replication"
    | "replicator"
    | "setting"
    | "tweakValue"
    | "API"
    | "database"
    | "databaseEvents"
    | "path"
    | "UI",
    "databaseFileAccess" | "rebuilder"
>;

export const everyOnloadAfterLoadSettingsHandler = (
    host: ReplicatorHost,
    processor: ReplicateResultProcessor
): Promise<boolean> => {
    const { services } = host;
    const settings = services.setting.settings;
    eventHub.onEvent(EVENT_FILE_SAVED, () => {
        if (settings.syncOnSave && !services.appLifecycle.isSuspended()) {
            scheduleTask("perform-replicate-after-save", 250, () => services.replication.replicateByEvent());
        }
    });
    eventHub.onEvent(EVENT_SETTING_SAVED, (setting) => {
        if (settings.suspendParseReplicationResult) {
            processor.suspend();
        } else {
            processor.resume();
        }
    });

    return Promise.resolve(true);
};

export const onReplicatorInitialisedHandler = (): Promise<boolean> => {
    clearHandlers();
    return Promise.resolve(true);
};

export const everyOnDatabaseInitializedHandler = (
    processor: ReplicateResultProcessor,
    showNotice: boolean
): Promise<boolean> => {
    fireAndForget(() => processor.restoreFromSnapshotOnce());
    return Promise.resolve(true);
};

export const everyBeforeReplicateHandler = async (
    unresolvedErrorManager: UnresolvedErrorManager,
    processor: ReplicateResultProcessor,
    showMessage: boolean
): Promise<boolean> => {
    await processor.restoreFromSnapshotOnce();
    unresolvedErrorManager.clearErrors();
    return true;
};

export const cleanedHandler = async (host: ReplicatorHost, showMessage: boolean) => {
    const { services, serviceModules } = host;
    const settings = services.setting.settings;
    Logger(`The remote database has been cleaned.`, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
    await skipIfDuplicated("cleanup", async () => {
        const count = await purgeUnreferencedChunks(services.database.localDatabase.localDatabase, true);
        const message = `The remote database has been cleaned up.
To synchronize, this device must be also cleaned up. ${count} chunk(s) will be erased from this device.
However, If there are many chunks to be deleted, maybe fetching again is faster.
We will lose the history of this device if we fetch the remote database again.
Even if you choose to clean up, you will see this option again if you exit Obsidian and then synchronise again.`;
        const CHOICE_FETCH = "Fetch again";
        const CHOICE_CLEAN = "Cleanup";
        const CHOICE_DISMISS = "Dismiss";
        const ret = await host.services.UI?.confirm.confirmWithMessage(
            "Cleaned",
            message,
            [CHOICE_FETCH, CHOICE_CLEAN, CHOICE_DISMISS],
            CHOICE_DISMISS,
            30
        );
        if (ret == CHOICE_FETCH) {
            await serviceModules.rebuilder.$performRebuildDB("localOnly");
        }
        if (ret == CHOICE_CLEAN) {
            const replicator = services.replicator.getActiveReplicator();
            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
            const remoteDB = await replicator.connectRemoteCouchDBWithSetting(settings, services.API.isMobile(), true);
            if (typeof remoteDB == "string") {
                Logger(remoteDB, LOG_LEVEL_NOTICE);
                return false;
            }

            await purgeUnreferencedChunks(services.database.localDatabase.localDatabase, false);
            services.database.localDatabase.clearCaches();
            const activeReplicator = services.replicator.getActiveReplicator();
            if (activeReplicator && (await activeReplicator.openReplication(settings, false, showMessage, true))) {
                await balanceChunkPurgedDBs(services.database.localDatabase.localDatabase, remoteDB.db);
                await purgeUnreferencedChunks(services.database.localDatabase.localDatabase, false);
                services.database.localDatabase.clearCaches();
                await activeReplicator.markRemoteResolved(settings);
                Logger("The local database has been cleaned up.", showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
            } else {
                Logger(
                    "Replication has been cancelled. Please try it again.",
                    showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                );
            }
        }
    });
};

export const onReplicationFailedHandler = async (
    host: ReplicatorHost,
    showMessage: boolean = false
): Promise<boolean> => {
    const { services, serviceModules } = host;
    const settings = services.setting.settings;
    const activeReplicator = services.replicator.getActiveReplicator();
    if (!activeReplicator) {
        Logger(`No active replicator found`, LOG_LEVEL_INFO);
        return false;
    }
    if (activeReplicator.tweakSettingsMismatched && activeReplicator.preferredTweakValue) {
        await services.tweakValue.askResolvingMismatched(activeReplicator.preferredTweakValue);
    } else {
        if (activeReplicator.remoteLockedAndDeviceNotAccepted) {
            if (activeReplicator.remoteCleaned && settings.useIndexedDBAdapter) {
                await cleanedHandler(host, showMessage);
            } else {
                const message = $msg("Replicator.Dialogue.Locked.Message");
                const CHOICE_FETCH = $msg("Replicator.Dialogue.Locked.Action.Fetch");
                const CHOICE_DISMISS = $msg("Replicator.Dialogue.Locked.Action.Dismiss");
                const CHOICE_UNLOCK = $msg("Replicator.Dialogue.Locked.Action.Unlock");
                const ret = await host.services.UI?.confirm.askSelectStringDialogue(
                    message,
                    [CHOICE_FETCH, CHOICE_UNLOCK, CHOICE_DISMISS],
                    {
                        title: $msg("Replicator.Dialogue.Locked.Title"),
                        defaultAction: CHOICE_DISMISS,
                        timeout: 60,
                    }
                );
                if (ret == CHOICE_FETCH) {
                    Logger($msg("Replicator.Dialogue.Locked.Message.Fetch"), LOG_LEVEL_NOTICE);
                    await serviceModules.rebuilder.scheduleFetch();
                    services.appLifecycle.scheduleRestart();
                    return false;
                } else if (ret == CHOICE_UNLOCK) {
                    await activeReplicator.markRemoteResolved(settings);
                    Logger($msg("Replicator.Dialogue.Locked.Message.Unlocked"), LOG_LEVEL_NOTICE);
                    return false;
                }
            }
        }
    }
    return false;
};

export const parseReplicationResultHandler = (
    processor: ReplicateResultProcessor,
    docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>
): Promise<boolean> => {
    processor.enqueueAll(docs);
    return Promise.resolve(true);
};

export function useReplicator(host: ReplicatorHost) {
    const { services, serviceModules } = host;
    const settings = services.setting.settings;

    const processor = new ReplicateResultProcessor(host as any);
    const unresolvedErrorManager = new UnresolvedErrorManager(services.appLifecycle);

    services.replicator.onReplicatorInitialised.addHandler(onReplicatorInitialisedHandler);
    services.databaseEvents.onDatabaseInitialised.addHandler(everyOnDatabaseInitializedHandler.bind(null, processor));
    services.appLifecycle.onSettingLoaded.addHandler(everyOnloadAfterLoadSettingsHandler.bind(null, host, processor));
    services.replication.parseSynchroniseResult.addHandler(parseReplicationResultHandler.bind(null, processor));

    const isOnlineAndCanReplicateWithHost = isOnlineAndCanReplicate.bind(null, unresolvedErrorManager, {
        services: {
            API: services.API,
        },
        serviceModules: {},
    });
    const canReplicateWithPBKDF2WithHost = canReplicateWithPBKDF2.bind(null, unresolvedErrorManager, {
        services: {
            replicator: services.replicator,
            setting: services.setting,
        },
        serviceModules: {},
    });

    services.replication.onBeforeReplicate.addHandler(isOnlineAndCanReplicateWithHost, 10);
    services.replication.onBeforeReplicate.addHandler(canReplicateWithPBKDF2WithHost, 20);
    services.replication.onBeforeReplicate.addHandler(
        everyBeforeReplicateHandler.bind(null, unresolvedErrorManager, processor),
        100
    );
    services.replication.onReplicationFailed.addHandler(onReplicationFailedHandler.bind(null, host));

    registerReplicatorCommands(host);
}
