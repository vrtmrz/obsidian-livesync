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
import { throttle } from "octagonal-wheels/function";
import { arrayToChunkedArray } from "octagonal-wheels/collection";
import {
    SYNCINFO_ID,
    VER,
    type EntryBody,
    type EntryDoc,
    type EntryLeaf,
    type LoadedEntry,
    type MetaEntry,
    type RemoteType,
} from "../../lib/src/common/types";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import {
    getPath,
    isChunk,
    isValidPath,
    rateLimitedSharedExecution,
    scheduleTask,
    updatePreviousExecutionTime,
} from "../../common/utils";
import { isAnyNote } from "../../lib/src/common/utils";
import { EVENT_FILE_SAVED, EVENT_ON_UNRESOLVED_ERROR, EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";

import { $msg } from "../../lib/src/common/i18n";
import { clearHandlers } from "../../lib/src/replication/SyncParamsHandler";
import type { LiveSyncCore } from "../../main";

const KEY_REPLICATION_ON_EVENT = "replicationOnEvent";
const REPLICATION_ON_EVENT_FORECASTED_TIME = 5000;

export class ModuleReplicator extends AbstractModule {
    _replicatorType?: RemoteType;
    _previousErrors = new Set<string>();

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
        await this.loadQueuedFiles();
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
        if (this.settings.suspendParseReplicationResult && !this.replicationResultProcessor.isSuspended) {
            this.replicationResultProcessor.suspend();
        }
        this.replicationResultProcessor.enqueueAll(docs);
        if (!this.settings.suspendParseReplicationResult && this.replicationResultProcessor.isSuspended) {
            this.replicationResultProcessor.resume();
        }
    }
    _saveQueuedFiles = throttle(() => {
        const saveData = this.replicationResultProcessor._queue
            .filter((e) => e !== undefined && e !== null)
            .map((e) => e?._id ?? ("" as string)) as string[];
        const kvDBKey = "queued-files";
        // localStorage.setItem(lsKey, saveData);
        fireAndForget(() => this.core.kvDB.set(kvDBKey, saveData));
    }, 100);
    saveQueuedFiles() {
        this._saveQueuedFiles();
    }
    async loadQueuedFiles() {
        if (this.settings.suspendParseReplicationResult) return;
        if (!this.settings.isConfigured) return;
        try {
            const kvDBKey = "queued-files";
            // const ids = [...new Set(JSON.parse(localStorage.getItem(lsKey) || "[]"))] as string[];
            const ids = [...new Set((await this.core.kvDB.get<string[]>(kvDBKey)) ?? [])];
            const batchSize = 100;
            const chunkedIds = arrayToChunkedArray(ids, batchSize);

            // suspendParseReplicationResult is true, so we have to resume it if it is suspended.
            if (this.replicationResultProcessor.isSuspended) {
                this.replicationResultProcessor.resume();
            }
            for await (const idsBatch of chunkedIds) {
                const ret = await this.localDatabase.allDocsRaw<EntryDoc>({
                    keys: idsBatch,
                    include_docs: true,
                    limit: 100,
                });
                const docs = ret.rows
                    .filter((e) => e.doc)
                    .map((e) => e.doc) as PouchDB.Core.ExistingDocument<EntryDoc>[];
                const errors = ret.rows.filter((e) => !e.doc && !e.value.deleted);
                if (errors.length > 0) {
                    Logger("Some queued processes were not resurrected");
                    Logger(JSON.stringify(errors), LOG_LEVEL_VERBOSE);
                }
                this.replicationResultProcessor.enqueueAll(docs);
            }
        } catch (e) {
            Logger(`Failed to load queued files.`, LOG_LEVEL_NOTICE);
            Logger(e, LOG_LEVEL_VERBOSE);
        } finally {
            // Check again before awaiting,
            if (this.replicationResultProcessor.isSuspended) {
                this.replicationResultProcessor.resume();
            }
        }
        // Wait for all queued files to be processed.
        try {
            await this.replicationResultProcessor.waitForAllProcessed();
        } catch (e) {
            Logger(`Failed to wait for all queued files to be processed.`, LOG_LEVEL_NOTICE);
            Logger(e, LOG_LEVEL_VERBOSE);
        }
    }

    replicationResultProcessor = new QueueProcessor(
        async (docs: PouchDB.Core.ExistingDocument<EntryDoc>[]) => {
            if (this.settings.suspendParseReplicationResult) return;
            const change = docs[0];
            if (!change) return;
            if (isChunk(change._id)) {
                this.localDatabase.onNewLeaf(change as EntryLeaf);
                return;
            }
            if (await this.services.replication.processVirtualDocument(change)) return;
            // any addon needs this item?
            // for (const proc of this.core.addOns) {
            //     if (await proc.parseReplicationResultItem(change)) {
            //         return;
            //     }
            // }
            if (change.type == "versioninfo") {
                if (change.version > VER) {
                    this.core.replicator.closeReplication();
                    Logger(
                        `Remote database updated to incompatible version. update your Self-hosted LiveSync plugin.`,
                        LOG_LEVEL_NOTICE
                    );
                }
                return;
            }
            if (
                change._id == SYNCINFO_ID || // Synchronisation information data
                change._id.startsWith("_design") //design document
            ) {
                return;
            }
            if (isAnyNote(change)) {
                const docPath = getPath(change);
                if (!(await this.services.vault.isTargetFile(docPath))) {
                    Logger(`Skipped: ${docPath}`, LOG_LEVEL_VERBOSE);
                    return;
                }
                if (this.databaseQueuedProcessor._isSuspended) {
                    Logger(`Processing scheduled: ${docPath}`, LOG_LEVEL_INFO);
                }
                const size = change.size;
                if (this.services.vault.isFileSizeTooLarge(size)) {
                    Logger(
                        `Processing ${docPath} has been skipped due to file size exceeding the limit`,
                        LOG_LEVEL_NOTICE
                    );
                    return;
                }
                this.databaseQueuedProcessor.enqueue(change);
            }
            return;
        },
        {
            batchSize: 1,
            suspended: true,
            concurrentLimit: 100,
            delay: 0,
            totalRemainingReactiveSource: this.core.replicationResultCount,
        }
    )
        .replaceEnqueueProcessor((queue, newItem) => {
            const q = queue.filter((e) => e._id != newItem._id);
            return [...q, newItem];
        })
        .startPipeline()
        .onUpdateProgress(() => {
            this.saveQueuedFiles();
        });

    async checkIsChangeRequiredForDatabaseProcessing(dbDoc: LoadedEntry): Promise<boolean> {
        const path = getPath(dbDoc);
        try {
            const savedDoc = await this.localDatabase.getRaw<LoadedEntry>(dbDoc._id, {
                conflicts: true,
                revs_info: true,
            });
            const newRev = dbDoc._rev ?? "";
            const latestRev = savedDoc._rev ?? "";
            const revisions = savedDoc._revs_info?.map((e) => e.rev) ?? [];
            if (savedDoc._conflicts && savedDoc._conflicts.length > 0) {
                // There are conflicts, so we have to process it.
                return true;
            }
            if (newRev == latestRev) {
                // The latest revision. We need to process it.
                return true;
            }
            const index = revisions.indexOf(newRev);
            if (index >= 0) {
                // the revision has been inserted before.
                return false; // Already processed.
            }
            return true; // This mostly should not happen, but we have to process it just in case.
        } catch (e: any) {
            if ("status" in e && e.status == 404) {
                return true;
                // Not existing, so we have to process it.
            } else {
                Logger(
                    `Failed to get existing document for ${path} (${dbDoc._id.substring(0, 8)}, ${dbDoc._rev?.substring(0, 10)}) `,
                    LOG_LEVEL_NOTICE
                );
                Logger(e, LOG_LEVEL_VERBOSE);
                return true;
            }
        }
        return true;
    }

    databaseQueuedProcessor = new QueueProcessor(
        async (docs: EntryBody[]) => {
            const dbDoc = docs[0] as LoadedEntry; // It has no `data`
            const path = getPath(dbDoc);
            // If the document is existing with any revision, confirm that we have to process it.
            const isRequired = await this.checkIsChangeRequiredForDatabaseProcessing(dbDoc);
            if (!isRequired) {
                Logger(`Skipped (Not latest): ${path} (${dbDoc._id.substring(0, 8)})`, LOG_LEVEL_VERBOSE);
                return;
            }
            // If `Read chunks online` is disabled, chunks should be transferred before here.
            // However, in some cases, chunks are after that. So, if missing chunks exist, we have to wait for them.
            const doc = await this.localDatabase.getDBEntryFromMeta({ ...dbDoc }, false, true);
            if (!doc) {
                Logger(
                    `Something went wrong while gathering content of ${path} (${dbDoc._id.substring(0, 8)}, ${dbDoc._rev?.substring(0, 10)}) `,
                    LOG_LEVEL_NOTICE
                );
                return;
            }

            if (await this.services.replication.processOptionalSynchroniseResult(dbDoc)) {
                // Already processed
            } else if (isValidPath(getPath(doc))) {
                this.storageApplyingProcessor.enqueue(doc as MetaEntry);
            } else {
                Logger(`Skipped: ${path} (${doc._id.substring(0, 8)})`, LOG_LEVEL_VERBOSE);
            }
            return;
        },
        {
            suspended: true,
            batchSize: 1,
            concurrentLimit: 10,
            yieldThreshold: 1,
            delay: 0,
            totalRemainingReactiveSource: this.core.databaseQueueCount,
        }
    )
        .replaceEnqueueProcessor((queue, newItem) => {
            const q = queue.filter((e) => e._id != newItem._id);
            return [...q, newItem];
        })
        .startPipeline();

    storageApplyingProcessor = new QueueProcessor(
        async (docs: MetaEntry[]) => {
            const entry = docs[0];
            await this.services.replication.processSynchroniseResult(entry);
            return;
        },
        {
            suspended: true,
            batchSize: 1,
            concurrentLimit: 6,
            yieldThreshold: 1,
            delay: 0,
            totalRemainingReactiveSource: this.core.storageApplyingCount,
        }
    )
        .replaceEnqueueProcessor((queue, newItem) => {
            const q = queue.filter((e) => e._id != newItem._id);
            return [...q, newItem];
        })
        .startPipeline();

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
        services.replicator.handleGetActiveReplicator(this._getReplicator.bind(this));
        services.databaseEvents.handleOnDatabaseInitialisation(this._everyOnInitializeDatabase.bind(this));
        services.databaseEvents.handleOnResetDatabase(this._everyOnResetDatabase.bind(this));
        services.appLifecycle.handleOnSettingLoaded(this._everyOnloadAfterLoadSettings.bind(this));
        services.replication.handleParseSynchroniseResult(this._parseReplicationResult.bind(this));
        services.appLifecycle.handleOnSuspending(this._everyBeforeSuspendProcess.bind(this));
        services.replication.handleBeforeReplicate(this._everyBeforeReplicate.bind(this));
        services.replication.handleIsReplicationReady(this._canReplicate.bind(this));
        services.replication.handleReplicate(this._replicate.bind(this));
        services.replication.handleReplicateByEvent(this._replicateByEvent.bind(this));
        services.remote.handleReplicateAllToRemote(this._replicateAllToServer.bind(this));
        services.remote.handleReplicateAllFromRemote(this._replicateAllFromServer.bind(this));
        services.appLifecycle.reportUnresolvedMessages(this._reportUnresolvedMessages.bind(this));
    }
}
