import { fireAndForget, yieldMicrotask } from "octagonal-wheels/promises";
import type { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB";
import { AbstractModule } from "../AbstractModule";
import {
    Logger,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_INFO,
    LOG_LEVEL_VERBOSE,
    LEVEL_NOTICE,
    LEVEL_INFO,
    type LOG_LEVEL,
} from "octagonal-wheels/common/logger";
import { isLockAcquired, shareRunningResult, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { balanceChunkPurgedDBs } from "@/lib/src/pouchdb/chunks";
import { purgeUnreferencedChunks } from "@/lib/src/pouchdb/chunks";
import { LiveSyncCouchDBReplicator } from "../../lib/src/replication/couchdb/LiveSyncReplicator";
import { type EntryDoc, type RemoteType } from "../../lib/src/common/types";
import { rateLimitedSharedExecution, scheduleTask, updatePreviousExecutionTime } from "../../common/utils";
import { EVENT_FILE_SAVED, EVENT_ON_UNRESOLVED_ERROR, EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";

import { $msg } from "../../lib/src/common/i18n";
import { clearHandlers } from "../../lib/src/replication/SyncParamsHandler";
import type { LiveSyncCore } from "../../main";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";

const KEY_REPLICATION_ON_EVENT = "replicationOnEvent";
const REPLICATION_ON_EVENT_FORECASTED_TIME = 5000;

export class ModuleReplicator extends AbstractModule {
    _replicatorType?: RemoteType;
    _previousErrors = new Set<string>();
    processor: ReplicateResultProcessor = new ReplicateResultProcessor(this);

    showError(msg: string, max_log_level: LOG_LEVEL = LEVEL_NOTICE) {
        const level = this._previousErrors.has(msg) ? LEVEL_INFO : max_log_level;
        this._log(msg, level);
        if (!this._previousErrors.has(msg)) {
            this._previousErrors.add(msg);
            eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
        }
    }
    clearErrors() {
        this._previousErrors.clear();
        eventHub.emitEvent(EVENT_ON_UNRESOLVED_ERROR);
    }

    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        eventHub.onEvent(EVENT_FILE_SAVED, () => {
            if (this.settings.syncOnSave && !this.core.services.appLifecycle.isSuspended()) {
                scheduleTask("perform-replicate-after-save", 250, () => this.services.replication.replicateByEvent());
            }
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (setting) => {
            if (this._replicatorType !== setting.remoteType) {
                void this.setReplicator();
            }
            if (this.core.settings.suspendParseReplicationResult) {
                this.processor.suspend();
            } else {
                this.processor.resume();
            }
        });

        return Promise.resolve(true);
    }

    async setReplicator() {
        const replicator = await this.services.replicator.getNewReplicator();
        if (!replicator) {
            this.showError($msg("Replicator.Message.InitialiseFatalError"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (this.core.replicator) {
            await this.core.replicator.closeReplication();
            this._log("Replicator closed for changing", LOG_LEVEL_VERBOSE);
        }
        this.core.replicator = replicator;
        this._replicatorType = this.settings.remoteType;
        await yieldMicrotask();
        // Clear any existing sync parameter handlers (means clearing key-deriving salt).
        clearHandlers();
        return true;
    }

    _getReplicator(): LiveSyncAbstractReplicator {
        return this.core.replicator;
    }

    _everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return this.setReplicator();
    }
    _everyOnDatabaseInitialized(showNotice: boolean): Promise<boolean> {
        fireAndForget(() => this.processor.restoreFromSnapshotOnce());
        return Promise.resolve(true);
    }

    _everyOnResetDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return this.setReplicator();
    }
    async ensureReplicatorPBKDF2Salt(showMessage: boolean = false): Promise<boolean> {
        // Checking salt
        const replicator = this.services.replicator.getActiveReplicator();
        if (!replicator) {
            this.showError($msg("Replicator.Message.InitialiseFatalError"), LOG_LEVEL_NOTICE);
            return false;
        }
        return await replicator.ensurePBKDF2Salt(this.settings, showMessage, true);
    }

    async _everyBeforeReplicate(showMessage: boolean): Promise<boolean> {
        // Checking salt
        if (!this.core.managers.networkManager.isOnline) {
            this.showError("Network is offline", showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
            return false;
        }
        // Showing message is false: that because be shown here. (And it is a fatal error, no way to hide it).
        if (!(await this.ensureReplicatorPBKDF2Salt(false))) {
            this.showError("Failed to initialise the encryption key, preventing replication.");
            return false;
        }
        await this.processor.restoreFromSnapshotOnce();
        this.clearErrors();
        return true;
    }

    private async _replicate(showMessage: boolean = false): Promise<boolean | void> {
        try {
            updatePreviousExecutionTime(KEY_REPLICATION_ON_EVENT, REPLICATION_ON_EVENT_FORECASTED_TIME);
            return await this.$$_replicate(showMessage);
        } finally {
            updatePreviousExecutionTime(KEY_REPLICATION_ON_EVENT);
        }
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

    async _canReplicate(showMessage: boolean = false): Promise<boolean> {
        if (!this.services.appLifecycle.isReady()) {
            Logger(`Not ready`);
            return false;
        }

        if (isLockAcquired("cleanup")) {
            Logger($msg("Replicator.Message.Cleaned"), LOG_LEVEL_NOTICE);
            return false;
        }

        if (this.settings.versionUpFlash != "") {
            Logger($msg("Replicator.Message.VersionUpFlash"), LOG_LEVEL_NOTICE);
            return false;
        }

        if (!(await this.services.fileProcessing.commitPendingFileEvents())) {
            this.showError($msg("Replicator.Message.Pending"), LOG_LEVEL_NOTICE);
            return false;
        }

        if (!this.core.managers.networkManager.isOnline) {
            this.showError("Network is offline", showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
            return false;
        }
        if (!(await this.services.replication.onBeforeReplicate(showMessage))) {
            this.showError($msg("Replicator.Message.SomeModuleFailed"), LOG_LEVEL_NOTICE);
            return false;
        }
        this.clearErrors();
        return true;
    }

    async $$_replicate(showMessage: boolean = false): Promise<boolean | void> {
        const checkBeforeReplicate = await this.services.replication.isReplicationReady(showMessage);
        if (!checkBeforeReplicate) return false;

        //<-- Here could be an module.
        const ret = await this.core.replicator.openReplication(this.settings, false, showMessage, false);
        if (!ret) {
            if (this.core.replicator.tweakSettingsMismatched && this.core.replicator.preferredTweakValue) {
                await this.services.tweakValue.askResolvingMismatched(this.core.replicator.preferredTweakValue);
            } else {
                if (this.core.replicator?.remoteLockedAndDeviceNotAccepted) {
                    if (this.core.replicator.remoteCleaned && this.settings.useIndexedDBAdapter) {
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
                            return;
                        } else if (ret == CHOICE_UNLOCK) {
                            await this.core.replicator.markRemoteResolved(this.settings);
                            this._log($msg("Replicator.Dialogue.Locked.Message.Unlocked"), LOG_LEVEL_NOTICE);
                            return;
                        }
                    }
                }
            }
        }
        return ret;
    }

    private async _replicateByEvent(): Promise<boolean | void> {
        const least = this.settings.syncMinimumInterval;
        if (least > 0) {
            return rateLimitedSharedExecution(KEY_REPLICATION_ON_EVENT, least, async () => {
                return await this.services.replication.replicate();
            });
        }
        return await shareRunningResult(`replication`, () => this.services.replication.replicate());
    }

    _parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void {
        this.processor.enqueueAll(docs);
    }

    _everyBeforeSuspendProcess(): Promise<boolean> {
        this.core.replicator?.closeReplication();
        return Promise.resolve(true);
    }

    private async _replicateAllToServer(
        showingNotice: boolean = false,
        sendChunksInBulkDisabled: boolean = false
    ): Promise<boolean> {
        if (!this.services.appLifecycle.isReady()) return false;
        if (!(await this.services.replication.onBeforeReplicate(showingNotice))) {
            Logger($msg("Replicator.Message.SomeModuleFailed"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (!sendChunksInBulkDisabled) {
            if (this.core.replicator instanceof LiveSyncCouchDBReplicator) {
                if (
                    (await this.core.confirm.askYesNoDialog("Do you want to send all chunks before replication?", {
                        defaultOption: "No",
                        timeout: 20,
                    })) == "yes"
                ) {
                    await this.core.replicator.sendChunks(this.core.settings, undefined, true, 0);
                }
            }
        }
        const ret = await this.core.replicator.replicateAllToServer(this.settings, showingNotice);
        if (ret) return true;
        const checkResult = await this.services.replication.checkConnectionFailure();
        if (checkResult == "CHECKAGAIN") return await this.services.remote.replicateAllToRemote(showingNotice);
        return !checkResult;
    }
    async _replicateAllFromServer(showingNotice: boolean = false): Promise<boolean> {
        if (!this.services.appLifecycle.isReady()) return false;
        const ret = await this.core.replicator.replicateAllFromServer(this.settings, showingNotice);
        if (ret) return true;
        const checkResult = await this.services.replication.checkConnectionFailure();
        if (checkResult == "CHECKAGAIN") return await this.services.remote.replicateAllFromRemote(showingNotice);
        return !checkResult;
    }

    private _reportUnresolvedMessages(): Promise<string[]> {
        return Promise.resolve([...this._previousErrors]);
    }

    onBindFunction(core: LiveSyncCore, services: typeof core.services): void {
        services.replicator.getActiveReplicator.setHandler(this._getReplicator.bind(this));
        services.databaseEvents.onDatabaseInitialisation.addHandler(this._everyOnInitializeDatabase.bind(this));
        services.databaseEvents.onDatabaseInitialised.addHandler(this._everyOnDatabaseInitialized.bind(this));
        services.databaseEvents.onResetDatabase.addHandler(this._everyOnResetDatabase.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        services.replication.parseSynchroniseResult.setHandler(this._parseReplicationResult.bind(this));
        services.appLifecycle.onSuspending.addHandler(this._everyBeforeSuspendProcess.bind(this));
        services.replication.onBeforeReplicate.addHandler(this._everyBeforeReplicate.bind(this));
        services.replication.isReplicationReady.setHandler(this._canReplicate.bind(this));
        services.replication.replicate.setHandler(this._replicate.bind(this));
        services.replication.replicateByEvent.setHandler(this._replicateByEvent.bind(this));
        services.remote.replicateAllToRemote.setHandler(this._replicateAllToServer.bind(this));
        services.remote.replicateAllFromRemote.setHandler(this._replicateAllFromServer.bind(this));
        services.appLifecycle.getUnresolvedMessages.addHandler(this._reportUnresolvedMessages.bind(this));
    }
}
