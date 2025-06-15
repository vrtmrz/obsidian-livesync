import { fireAndForget, yieldMicrotask } from "octagonal-wheels/promises";
import type { LiveSyncLocalDB } from "../../lib/src/pouchdb/LiveSyncLocalDB";
import { AbstractModule } from "../AbstractModule";
import type { ICoreModule } from "../ModuleTypes";
import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { isLockAcquired, shareRunningResult, skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { purgeUnreferencedChunks, balanceChunkPurgedDBs } from "../../lib/src/pouchdb/utils_couchdb";
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
import { EVENT_FILE_SAVED, EVENT_SETTING_SAVED, eventHub } from "../../common/events";
import type { LiveSyncAbstractReplicator } from "../../lib/src/replication/LiveSyncAbstractReplicator";
import { globalSlipBoard } from "../../lib/src/bureau/bureau";
import { $msg } from "../../lib/src/common/i18n";

const KEY_REPLICATION_ON_EVENT = "replicationOnEvent";
const REPLICATION_ON_EVENT_FORECASTED_TIME = 5000;

export class ModuleReplicator extends AbstractModule implements ICoreModule {
    _replicatorType?: string;
    $everyOnloadAfterLoadSettings(): Promise<boolean> {
        eventHub.onEvent(EVENT_FILE_SAVED, () => {
            if (this.settings.syncOnSave && !this.core.$$isSuspended()) {
                scheduleTask("perform-replicate-after-save", 250, () => this.core.$$replicateByEvent());
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
        const replicator = await this.core.$anyNewReplicator();
        if (!replicator) {
            this._log($msg("Replicator.Message.InitialiseFatalError"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (this.core.replicator) {
            await this.core.replicator.closeReplication();
            this._log("Replicator closed for changing", LOG_LEVEL_VERBOSE);
        }
        this.core.replicator = replicator;
        this._replicatorType = this.settings.remoteType;
        await yieldMicrotask();
        return true;
    }

    $$getReplicator(): LiveSyncAbstractReplicator {
        return this.core.replicator;
    }

    $everyOnInitializeDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return this.setReplicator();
    }

    $everyOnResetDatabase(db: LiveSyncLocalDB): Promise<boolean> {
        return this.setReplicator();
    }

    async $everyBeforeReplicate(showMessage: boolean): Promise<boolean> {
        await this.loadQueuedFiles();
        return true;
    }

    async $$replicate(showMessage: boolean = false): Promise<boolean | void> {
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
                const replicator = this.core.$$getReplicator();
                if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
                const remoteDB = await replicator.connectRemoteCouchDBWithSetting(
                    this.settings,
                    this.core.$$isMobile(),
                    true
                );
                if (typeof remoteDB == "string") {
                    Logger(remoteDB, LOG_LEVEL_NOTICE);
                    return false;
                }

                await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                this.localDatabase.hashCaches.clear();
                // Perform the synchronisation once.
                if (await this.core.replicator.openReplication(this.settings, false, showMessage, true)) {
                    await balanceChunkPurgedDBs(this.localDatabase.localDatabase, remoteDB.db);
                    await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                    this.localDatabase.hashCaches.clear();
                    await this.core.$$getReplicator().markRemoteResolved(this.settings);
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
    async $$_replicate(showMessage: boolean = false): Promise<boolean | void> {
        //--?
        if (!this.core.$$isReady()) return;
        if (isLockAcquired("cleanup")) {
            Logger($msg("Replicator.Message.Cleaned"), LOG_LEVEL_NOTICE);
            return;
        }
        if (this.settings.versionUpFlash != "") {
            Logger($msg("Replicator.Message.VersionUpFlash"), LOG_LEVEL_NOTICE);
            return;
        }
        if (!(await this.core.$everyCommitPendingFileEvent())) {
            Logger($msg("Replicator.Message.Pending"), LOG_LEVEL_NOTICE);
            return false;
        }
        if (!(await this.core.$everyBeforeReplicate(showMessage))) {
            Logger($msg("Replicator.Message.SomeModuleFailed"), LOG_LEVEL_NOTICE);
            return false;
        }

        //<-- Here could be an module.
        const ret = await this.core.replicator.openReplication(this.settings, false, showMessage, false);
        if (!ret) {
            if (this.core.replicator.tweakSettingsMismatched && this.core.replicator.preferredTweakValue) {
                await this.core.$$askResolvingMismatchedTweaks(this.core.replicator.preferredTweakValue);
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
                            this.core.$$scheduleAppReload();
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

    async $$replicateByEvent(): Promise<boolean | void> {
        const least = this.settings.syncMinimumInterval;
        if (least > 0) {
            return rateLimitedSharedExecution(KEY_REPLICATION_ON_EVENT, least, async () => {
                return await this.$$replicate();
            });
        }
        return await shareRunningResult(`replication`, () => this.core.$$replicate());
    }
    $$parseReplicationResult(docs: Array<PouchDB.Core.ExistingDocument<EntryDoc>>): void {
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
                globalSlipBoard.submit("read-chunk", change._id, change as EntryLeaf);
                return;
            }
            if (await this.core.$anyModuleParsedReplicationResultItem(change)) return;
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
                if (!(await this.core.$$isTargetFile(docPath))) {
                    Logger(`Skipped: ${docPath}`, LOG_LEVEL_VERBOSE);
                    return;
                }
                if (this.databaseQueuedProcessor._isSuspended) {
                    Logger(`Processing scheduled: ${docPath}`, LOG_LEVEL_INFO);
                }
                const size = change.size;
                if (this.core.$$isFileSizeExceeded(size)) {
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

    databaseQueuedProcessor = new QueueProcessor(
        async (docs: EntryBody[]) => {
            const dbDoc = docs[0] as LoadedEntry; // It has no `data`
            const path = getPath(dbDoc);

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

            if (await this.core.$anyProcessOptionalSyncFiles(dbDoc)) {
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
            await this.core.$anyProcessReplicatedDoc(entry);
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

    $everyBeforeSuspendProcess(): Promise<boolean> {
        this.core.replicator.closeReplication();
        return Promise.resolve(true);
    }

    async $$replicateAllToServer(
        showingNotice: boolean = false,
        sendChunksInBulkDisabled: boolean = false
    ): Promise<boolean> {
        if (!this.core.$$isReady()) return false;
        if (!(await this.core.$everyBeforeReplicate(showingNotice))) {
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
        const checkResult = await this.core.$anyAfterConnectCheckFailed();
        if (checkResult == "CHECKAGAIN") return await this.core.$$replicateAllToServer(showingNotice);
        return !checkResult;
    }
    async $$replicateAllFromServer(showingNotice: boolean = false): Promise<boolean> {
        if (!this.core.$$isReady()) return false;
        const ret = await this.core.replicator.replicateAllFromServer(this.settings, showingNotice);
        if (ret) return true;
        const checkResult = await this.core.$anyAfterConnectCheckFailed();
        if (checkResult == "CHECKAGAIN") return await this.core.$$replicateAllFromServer(showingNotice);
        return !checkResult;
    }
}
