import { fireAndForget } from "octagonal-wheels/promises";
import { AbstractModule } from "../AbstractModule";
import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_INFO } from "octagonal-wheels/common/logger";
import { skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { balanceChunkPurgedDBs } from "@lib/pouchdb/chunks";
import { purgeUnreferencedChunks } from "@lib/pouchdb/chunks";
import { LiveSyncCouchDBReplicator } from "../../lib/src/replication/couchdb/LiveSyncReplicator";
import { type EntryDoc, type RemoteType } from "../../lib/src/common/types";
import { scheduleTask } from "../../common/utils";
import { EVENT_FILE_SAVED, EVENT_SETTING_SAVED, eventHub } from "../../common/events";

import { $msg } from "../../lib/src/common/i18n";
import type { LiveSyncCore } from "../../main";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";
import { UnresolvedErrorManager } from "@lib/services/base/UnresolvedErrorManager";
import { clearHandlers } from "@lib/replication/SyncParamsHandler";
import type { NecessaryServices } from "@lib/interfaces/ServiceModule";
import { MARK_LOG_NETWORK_ERROR } from "@lib/services/lib/logUtils";

function isOnlineAndCanReplicate(
    errorManager: UnresolvedErrorManager,
    host: NecessaryServices<"API", any>,
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
    host: NecessaryServices<"replicator" | "setting", any>,
    showMessage: boolean
): Promise<boolean> {
    const currentSettings = host.services.setting.currentSettings();
    // TODO: check using PBKDF2 salt?
    const errorMessage = $msg("Replicator.Message.InitialiseFatalError");
    const replicator = host.services.replicator.getActiveReplicator();
    if (!replicator) {
        errorManager.showError(errorMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return false;
    }
    errorManager.clearError(errorMessage);
    // Showing message is false: that because be shown here. (And it is a fatal error, no way to hide it).
    // tagged as network error at beginning for error filtering with NetworkWarningStyles
    const ensureMessage = `${MARK_LOG_NETWORK_ERROR}Failed to initialise the encryption key, preventing replication.`;
    const ensureResult = await replicator.ensurePBKDF2Salt(currentSettings, showMessage, true);
    if (!ensureResult) {
        errorManager.showError(ensureMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return false;
    }
    errorManager.clearError(ensureMessage);
    return ensureResult; // is true.
}

export class ModuleReplicator extends AbstractModule {
    _replicatorType?: RemoteType;

    processor: ReplicateResultProcessor = new ReplicateResultProcessor(this);
    private _unresolvedErrorManager: UnresolvedErrorManager = new UnresolvedErrorManager(
        this.core.services.appLifecycle
    );

    clearErrors() {
        this._unresolvedErrorManager.clearErrors();
    }

    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        eventHub.onEvent(EVENT_FILE_SAVED, () => {
            if (this.settings.syncOnSave && !this.core.services.appLifecycle.isSuspended()) {
                scheduleTask("perform-replicate-after-save", 250, () => this.services.replication.replicateByEvent());
            }
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (setting) => {
            if (this.core.settings.suspendParseReplicationResult) {
                this.processor.suspend();
            } else {
                this.processor.resume();
            }
        });

        return Promise.resolve(true);
    }

    _onReplicatorInitialised(): Promise<boolean> {
        // For now, we only need to clear the error related to replicator initialisation, but in the future, if there are more things to do when the replicator is initialised, we can add them here.
        clearHandlers();
        return Promise.resolve(true);
    }

    _everyOnDatabaseInitialized(showNotice: boolean): Promise<boolean> {
        fireAndForget(() => this.processor.restoreFromSnapshotOnce());
        return Promise.resolve(true);
    }

    async _everyBeforeReplicate(showMessage: boolean): Promise<boolean> {
        await this.processor.restoreFromSnapshotOnce();
        this.clearErrors();
        return true;
    }

    /**
     * obsolete method. No longer maintained and will be removed in the future.
     * @deprecated v0.24.17
     * @param showMessage If true, show message to the user.
     */
    async cleaned(showMessage: boolean) {
        Logger(`The remote database has been cleaned.`, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        await skipIfDuplicated("cleanup", async () => {
            const count = await purgeUnreferencedChunks(this.localDatabase.localDatabase, true);
            const message = `The remote database has been cleaned up.
To synchronize, this device must be also cleaned up. ${count} chunk(s) will be erased from this device.
However, If there are many chunks to be deleted, maybe fetching again is faster.
We will lose the history of this device if we fetch the remote database again.
Even if you choose to clean up, you will see this option again if you exit Obsidian and then synchronise again.`;
            const CHOICE_FETCH = "Fetch again";
            const CHOICE_CLEAN = "Cleanup";
            const CHOICE_DISMISS = "Dismiss";
            const ret = await this.core.confirm.confirmWithMessage(
                "Cleaned",
                message,
                [CHOICE_FETCH, CHOICE_CLEAN, CHOICE_DISMISS],
                CHOICE_DISMISS,
                30
            );
            if (ret == CHOICE_FETCH) {
                await this.core.rebuilder.$performRebuildDB("localOnly");
            }
            if (ret == CHOICE_CLEAN) {
                const replicator = this.services.replicator.getActiveReplicator();
                if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
                const remoteDB = await replicator.connectRemoteCouchDBWithSetting(
                    this.settings,
                    this.services.API.isMobile(),
                    true
                );
                if (typeof remoteDB == "string") {
                    Logger(remoteDB, LOG_LEVEL_NOTICE);
                    return false;
                }

                await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                this.localDatabase.clearCaches();
                // Perform the synchronisation once.
                if (await this.core.replicator.openReplication(this.settings, false, showMessage, true)) {
                    await balanceChunkPurgedDBs(this.localDatabase.localDatabase, remoteDB.db);
                    await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                    this.localDatabase.clearCaches();
                    await this.services.replicator.getActiveReplicator()?.markRemoteResolved(this.settings);
                    Logger("The local database has been cleaned up.", showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
                } else {
                    Logger(
                        "Replication has been cancelled. Please try it again.",
                        showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                    );
                }
            }
        });
    }

    private async onReplicationFailed(showMessage: boolean = false): Promise<boolean> {
        const activeReplicator = this.services.replicator.getActiveReplicator();
        if (!activeReplicator) {
            Logger(`No active replicator found`, LOG_LEVEL_INFO);
            return false;
        }
        if (activeReplicator.tweakSettingsMismatched && activeReplicator.preferredTweakValue) {
            await this.services.tweakValue.askResolvingMismatched(activeReplicator.preferredTweakValue);
        } else {
            if (activeReplicator.remoteLockedAndDeviceNotAccepted) {
                if (activeReplicator.remoteCleaned && this.settings.useIndexedDBAdapter) {
                    await this.cleaned(showMessage);
                } else {
                    const message = $msg("Replicator.Dialogue.Locked.Message");
                    const CHOICE_FETCH = $msg("Replicator.Dialogue.Locked.Action.Fetch");
                    const CHOICE_DISMISS = $msg("Replicator.Dialogue.Locked.Action.Dismiss");
                    const CHOICE_UNLOCK = $msg("Replicator.Dialogue.Locked.Action.Unlock");
                    const ret = await this.core.confirm.askSelectStringDialogue(
                        message,
                        [CHOICE_FETCH, CHOICE_UNLOCK, CHOICE_DISMISS],
                        {
                            title: $msg("Replicator.Dialogue.Locked.Title"),
                            defaultAction: CHOICE_DISMISS,
                            timeout: 60,
                        }
                    );
                    if (ret == CHOICE_FETCH) {
                        this._log($msg("Replicator.Dialogue.Locked.Message.Fetch"), LOG_LEVEL_NOTICE);
                        await this.core.rebuilder.scheduleFetch();
                        this.services.appLifecycle.scheduleRestart();
                        return false;
                    } else if (ret == CHOICE_UNLOCK) {
                        await activeReplicator.markRemoteResolved(this.settings);
                        this._log($msg("Replicator.Dialogue.Locked.Message.Unlocked"), LOG_LEVEL_NOTICE);
                        return false;
                    }
                }
            }
        }
        // TODO: Check again and true/false return. This will be the result for performReplication.
        return false;
    }

    // private async _replicateByEvent(): Promise<boolean | void> {
    //     const least = this.settings.syncMinimumInterval;
    //     if (least > 0) {
    //         return rateLimitedSharedExecution(KEY_REPLICATION_ON_EVENT, least, async () => {
    //             return await this.services.replication.replicate();
    //         });
    //     }
    //     return await shareRunningResult(`replication`, () => this.services.replication.replicate());
    // }

    _parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): Promise<boolean> {
        this.processor.enqueueAll(docs);
        return Promise.resolve(true);
    }

    // _everyBeforeSuspendProcess(): Promise<boolean> {
    //     this.core.replicator?.closeReplication();
    //     return Promise.resolve(true);
    // }

    // private async _replicateAllToServer(
    //     showingNotice: boolean = false,
    //     sendChunksInBulkDisabled: boolean = false
    // ): Promise<boolean> {
    //     if (!this.services.appLifecycle.isReady()) return false;
    //     if (!(await this.services.replication.onBeforeReplicate(showingNotice))) {
    //         Logger($msg("Replicator.Message.SomeModuleFailed"), LOG_LEVEL_NOTICE);
    //         return false;
    //     }
    //     if (!sendChunksInBulkDisabled) {
    //         if (this.core.replicator instanceof LiveSyncCouchDBReplicator) {
    //             if (
    //                 (await this.core.confirm.askYesNoDialog("Do you want to send all chunks before replication?", {
    //                     defaultOption: "No",
    //                     timeout: 20,
    //                 })) == "yes"
    //             ) {
    //                 await this.core.replicator.sendChunks(this.core.settings, undefined, true, 0);
    //             }
    //         }
    //     }
    //     const ret = await this.core.replicator.replicateAllToServer(this.settings, showingNotice);
    //     if (ret) return true;
    //     const checkResult = await this.services.replication.checkConnectionFailure();
    //     if (checkResult == "CHECKAGAIN") return await this.services.remote.replicateAllToRemote(showingNotice);
    //     return !checkResult;
    // }
    // async _replicateAllFromServer(showingNotice: boolean = false): Promise<boolean> {
    //     if (!this.services.appLifecycle.isReady()) return false;
    //     const ret = await this.core.replicator.replicateAllFromServer(this.settings, showingNotice);
    //     if (ret) return true;
    //     const checkResult = await this.services.replication.checkConnectionFailure();
    //     if (checkResult == "CHECKAGAIN") return await this.services.remote.replicateAllFromRemote(showingNotice);
    //     return !checkResult;
    // }

    override onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.onReplicatorInitialised.addHandler(this._onReplicatorInitialised.bind(this));
        services.databaseEvents.onDatabaseInitialised.addHandler(this._everyOnDatabaseInitialized.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        services.replication.parseSynchroniseResult.addHandler(this._parseReplicationResult.bind(this));

        // --> These handlers can be separated.
        const isOnlineAndCanReplicateWithHost = isOnlineAndCanReplicate.bind(null, this._unresolvedErrorManager, {
            services: {
                API: services.API,
            },
            serviceModules: {},
        });
        const canReplicateWithPBKDF2WithHost = canReplicateWithPBKDF2.bind(null, this._unresolvedErrorManager, {
            services: {
                replicator: services.replicator,
                setting: services.setting,
            },
            serviceModules: {},
        });
        services.replication.onBeforeReplicate.addHandler(isOnlineAndCanReplicateWithHost, 10);
        services.replication.onBeforeReplicate.addHandler(canReplicateWithPBKDF2WithHost, 20);
        // <-- End of handlers that can be separated.
        services.replication.onBeforeReplicate.addHandler(this._everyBeforeReplicate.bind(this), 100);
        services.replication.onReplicationFailed.addHandler(this.onReplicationFailed.bind(this));
    }
}
