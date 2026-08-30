import type PouchDB from "pouchdb-core";
import { fireAndForget } from "octagonal-wheels/promises";
import { AbstractModule } from "@/modules/AbstractModule";
import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_INFO, LOG_LEVEL_VERBOSE } from "octagonal-wheels/common/logger";
import { skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { balanceChunkPurgedDBs } from "@vrtmrz/livesync-commonlib/compat/pouchdb/chunks";
import { purgeUnreferencedChunks } from "@vrtmrz/livesync-commonlib/compat/pouchdb/chunks";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import {
    type EntryDoc,
    type ObsidianLiveSyncSettings,
    type RemoteType,
} from "@vrtmrz/livesync-commonlib/compat/common/types";

import { scheduleTask } from "octagonal-wheels/concurrency/task";
import { EVENT_FILE_SAVED, EVENT_SETTING_SAVED, eventHub } from "@/common/events";

import { $msg } from "@/common/translation";
import type { LiveSyncCore } from "@/main";
import { ReplicateResultProcessor } from "./ReplicateResultProcessor";
import { UnresolvedErrorManager } from "@vrtmrz/livesync-commonlib/compat/services/base/UnresolvedErrorManager";
import { clearHandlers } from "@vrtmrz/livesync-commonlib/compat/replication/SyncParamsHandler";
import type { NecessaryServices } from "@vrtmrz/livesync-commonlib/compat/interfaces/ServiceModule";
import { MARK_LOG_NETWORK_ERROR } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { usesLegacyIndexedDBAdapter } from "@/common/compatibilitySettings.ts";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    NO_INTERACTION,
    REMOTE_RESOURCE_KINDS,
    type ReplicationFailureRequest,
} from "@vrtmrz/livesync-commonlib/replication";
import { withOwnedRemoteResource } from "@/common/ownedRemoteResource.ts";

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
/** Refresh and validate the selected central provider's owned Security Seed resource. */
async function canReplicateWithSecuritySeed(
    errorManager: UnresolvedErrorManager,
    host: NecessaryServices<"replicator" | "setting", never>,
    showMessage: boolean
): Promise<boolean> {
    const currentSettings = host.services.setting.currentSettings();
    const errorMessage = $msg("Replicator.Message.InitialiseFatalError");
    // Showing message is false: that because be shown here. (And it is a fatal error, no way to hide it).
    // tagged as network error at beginning for error filtering with NetworkWarningStyles
    const ensureMessage = `${MARK_LOG_NETWORK_ERROR}Failed to initialise the encryption key, preventing replication.`;
    try {
        const resource = await host.services.replicator.createRemoteResource(
            REMOTE_RESOURCE_KINDS.SECURITY_SEED,
            currentSettings
        );
        if (!resource) {
            errorManager.showError(errorMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
            return false;
        }
        errorManager.clearError(errorMessage);
        const seed = await withOwnedRemoteResource(resource, (ownedResource) => ownedResource.read());
        if (seed.length == 0) throw new Error("PBKDF2 salt (Security Seed) is empty");
    } catch (error) {
        Logger(error, LOG_LEVEL_VERBOSE);
        errorManager.showError(ensureMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return false;
    }
    errorManager.clearError(ensureMessage);
    return true;
}

export class ModuleReplicator extends AbstractModule {
    _replicatorType?: RemoteType;

    processor: ReplicateResultProcessor = new ReplicateResultProcessor(this);
    private _unresolvedErrorManager: UnresolvedErrorManager = new UnresolvedErrorManager(
        this.core.services.appLifecycle,
        this.core.services.context.events
    );

    clearErrors() {
        this._unresolvedErrorManager.clearErrors();
    }

    private _normalFileReflectionFilterSignature: string | undefined;

    private getNormalFileReflectionFilterSignature(
        settings: Pick<
            ObsidianLiveSyncSettings,
            | "handleFilenameCaseSensitive"
            | "ignoreFiles"
            | "maxMTimeForReflectEvents"
            | "syncIgnoreRegEx"
            | "syncInternalFiles"
            | "syncMaxSizeInMB"
            | "syncOnlyRegEx"
            | "useIgnoreFiles"
        >
    ): string {
        return JSON.stringify({
            handleFilenameCaseSensitive: settings.handleFilenameCaseSensitive ?? false,
            ignoreFiles: settings.ignoreFiles ?? "",
            maxMTimeForReflectEvents: settings.maxMTimeForReflectEvents ?? 0,
            syncIgnoreRegEx: settings.syncIgnoreRegEx ?? "",
            syncInternalFiles: settings.syncInternalFiles ?? false,
            syncMaxSizeInMB: settings.syncMaxSizeInMB ?? 0,
            syncOnlyRegEx: settings.syncOnlyRegEx ?? "",
            useIgnoreFiles: settings.useIgnoreFiles ?? false,
        });
    }

    private _everyOnloadAfterLoadSettings(): Promise<boolean> {
        this._normalFileReflectionFilterSignature = this.getNormalFileReflectionFilterSignature(this.settings);
        eventHub.onEvent(EVENT_FILE_SAVED, () => {
            if (this.settings.syncOnSave && !this.core.services.appLifecycle.isSuspended()) {
                scheduleTask("perform-replicate-after-save", 250, () =>
                    this.services.replication.replicateUnattendedByEvent({
                        trigger: "database-event",
                        interaction: NO_INTERACTION,
                    })
                );
            }
        });
        eventHub.onEvent(EVENT_SETTING_SAVED, (setting) => {
            const previousReflectionFilter = this._normalFileReflectionFilterSignature;
            const nextReflectionFilter = this.getNormalFileReflectionFilterSignature(setting);
            this._normalFileReflectionFilterSignature = nextReflectionFilter;
            if (this.core.settings.suspendParseReplicationResult) {
                this.processor.suspend();
            } else {
                this.processor.resume();
            }
            if (previousReflectionFilter !== undefined && previousReflectionFilter !== nextReflectionFilter) {
                fireAndForget(() => this.processor.reprocessStoredDocuments());
            }
        });

        return Promise.resolve(true);
    }

    _onBeforeReplicatorPublication(): Promise<boolean> {
        // Clear key-derivation handlers before the candidate Replicator becomes active.
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
     * Reconciles an IndexedDB-backed local database after replication reports that the remote was cleaned.
     *
     * The remote milestone remains a supported compatibility signal. The user can either fetch the remote
     * database again, or purge unreferenced local chunks before accepting this device again.
     *
     * @param showMessage Whether to show the recovery choices as user-facing notices.
     * @param setting Detached settings used by the failed attempt.
     * @param expectedContext Publication which produced the compatibility rejection.
     */
    async cleaned(
        showMessage: boolean,
        setting: ObsidianLiveSyncSettings,
        expectedContext: ReplicationFailureRequest["context"]
    ) {
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
                await this.services.replicator.runBoundedRemoteActivity(
                    () =>
                        this.services.replicator.runWithActiveReplicatorContext(async (context) => {
                            if (context !== expectedContext) return;
                            const replicator = context.replicator;
                            if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
                            const remoteDB = await replicator.connectRemoteCouchDBWithSetting(
                                setting,
                                this.services.API.isMobile(),
                                true
                            );
                            if (typeof remoteDB == "string") {
                                Logger(remoteDB, LOG_LEVEL_NOTICE);
                                return false;
                            }

                            try {
                                await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                                this.localDatabase.clearCaches();
                                // Perform the synchronisation once.
                                const replicated = await this.services.replicator.runFiniteReplicationActivity(
                                    () => replicator.openOneShotReplication(setting, showMessage, false, "sync", true),
                                    { label: "replication" }
                                );
                                if (replicated) {
                                    await balanceChunkPurgedDBs(this.localDatabase.localDatabase, remoteDB.db);
                                    await purgeUnreferencedChunks(this.localDatabase.localDatabase, false);
                                    this.localDatabase.clearCaches();
                                    await replicator.markRemoteResolved(setting);
                                    Logger(
                                        "The local database has been cleaned up.",
                                        showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                                    );
                                } else {
                                    Logger(
                                        "Replication has been cancelled. Please try it again.",
                                        showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                                    );
                                }
                            } finally {
                                await remoteDB.close();
                            }
                        }),
                    { label: "database-cleanup" }
                );
            }
        });
    }

    private async onReplicationFailed(request: ReplicationFailureRequest): Promise<boolean> {
        const { context, interaction, outcome, setting, showMessage } = request;
        if (!showMessage) {
            // Automatic requests may report the failure, but they must never
            // enter tweak, lock, fetch, unlock, or cleanup dialogues.
            Logger(`Replication failed on an unattended path.`, LOG_LEVEL_INFO);
            return false;
        }
        if (interaction.kind !== "permitted" || !interaction.permissions.failureRecovery) return false;
        const recovery = outcome.recoveryHint;
        if (!recovery) return false;
        if (
            recovery.reason === CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH &&
            recovery.preferredTweakValue
        ) {
            await this.services.tweakValue.askResolvingMismatched(
                recovery.preferredTweakValue,
                async (effectiveSetting) => {
                    let updated = false;
                    await this.services.replicator.runWithActiveReplicatorContext(async (activeContext) => {
                        if (activeContext !== context) return;
                        const candidate = activeContext.replicator as typeof activeContext.replicator & {
                            setPreferredRemoteTweakSettings?: (
                                setting: ObsidianLiveSyncSettings
                            ) => Promise<void>;
                        };
                        if (typeof candidate.setPreferredRemoteTweakSettings !== "function") return;
                        await candidate.setPreferredRemoteTweakSettings({ ...effectiveSetting });
                        updated = true;
                    });
                    return updated;
                }
            );
        } else {
            if (
                recovery.reason === CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_LOCKED ||
                recovery.reason === CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED
            ) {
                if (
                    recovery.reason === CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED &&
                    usesLegacyIndexedDBAdapter(setting)
                ) {
                    await this.cleaned(showMessage, setting, context);
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
                        let unlocked = false;
                        await this.services.replicator.runWithActiveReplicatorContext(async (activeContext) => {
                            if (activeContext !== context) return;
                            const replicator = activeContext.replicator as typeof activeContext.replicator & {
                                markRemoteResolved(setting: ObsidianLiveSyncSettings): Promise<void>;
                            };
                            if (typeof replicator.markRemoteResolved !== "function") return;
                            await replicator.markRemoteResolved(setting);
                            unlocked = true;
                        });
                        if (unlocked) {
                            this._log($msg("Replicator.Dialogue.Locked.Message.Unlocked"), LOG_LEVEL_NOTICE);
                        }
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
        services.replicator.onBeforeReplicatorPublication.addHandler(this._onBeforeReplicatorPublication.bind(this));
        services.databaseEvents.onDatabaseInitialised.addHandler(this._everyOnDatabaseInitialized.bind(this));
        services.appLifecycle.onSettingLoaded.addHandler(this._everyOnloadAfterLoadSettings.bind(this));
        services.replication.parseSynchroniseResult.addHandler(this._parseReplicationResult.bind(this));

        // --> These handlers can be separated.
        const isOnlineAndCanReplicateWithHost = isOnlineAndCanReplicate.bind(null, this._unresolvedErrorManager, {
            services: {
                context: services.context,
                API: services.API,
            },
            serviceModules: {},
        });
        const canReplicateWithSecuritySeedWithHost = canReplicateWithSecuritySeed.bind(
            null,
            this._unresolvedErrorManager,
            {
                services: {
                    context: services.context,
                    replicator: services.replicator,
                    setting: services.setting,
                },
                serviceModules: {},
            }
        );
        services.replication.onBeforeReplicate.addHandler(isOnlineAndCanReplicateWithHost, 10);
        services.replication.onPrepareCentralRemoteReplication.addHandler(canReplicateWithSecuritySeedWithHost);
        // <-- End of handlers that can be separated.
        services.replication.onBeforeReplicate.addHandler(this._everyBeforeReplicate.bind(this), 100);
        services.replication.onReplicationFailed.addHandler(this.onReplicationFailed.bind(this));
    }
}
