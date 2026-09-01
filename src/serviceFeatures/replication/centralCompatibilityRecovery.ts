import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, Logger } from "octagonal-wheels/common/logger";
import { skipIfDuplicated } from "octagonal-wheels/concurrency/lock";
import { balanceChunkPurgedDBs, purgeUnreferencedChunks } from "@vrtmrz/livesync-commonlib/compat/pouchdb/chunks";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    REPLICATION_PROGRESS_PRESENTATIONS,
    type ReplicatorInstance,
    type ReplicationFailureRequest,
} from "@vrtmrz/livesync-commonlib/replication";
import { $msg } from "@/common/translation";
import { usesLegacyIndexedDBAdapter } from "@/common/compatibilitySettings";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";

type CentralCompatibilityRecoveryServices = Pick<
    LiveSyncBaseCore["services"],
    "API" | "appLifecycle" | "replicator" | "tweakValue"
>;

/** Collaborators for applying a compatibility decision to its failed publication. */
interface CentralCompatibilityRecoveryContext {
    readonly confirm: LiveSyncBaseCore["confirm"];
    /** Obtain the database only when recovery runs, after initialisation or reset. */
    readonly getLocalDatabase: () => LiveSyncBaseCore["localDatabase"];
    readonly rebuilder: LiveSyncBaseCore["rebuilder"];
    readonly services: CentralCompatibilityRecoveryServices;
}

interface PreferredRemoteTweakWriter extends ReplicatorInstance {
    setPreferredRemoteTweakSettings(setting: ObsidianLiveSyncSettings): Promise<void>;
}

interface ResolvedRemoteWriter extends ReplicatorInstance {
    markRemoteResolved(setting: ObsidianLiveSyncSettings): Promise<void>;
}

function canSetPreferredRemoteTweakSettings(replicator: ReplicatorInstance): replicator is PreferredRemoteTweakWriter {
    return (
        "setPreferredRemoteTweakSettings" in replicator &&
        typeof replicator.setPreferredRemoteTweakSettings === "function"
    );
}

function canMarkRemoteResolved(replicator: ReplicatorInstance): replicator is ResolvedRemoteWriter {
    return "markRemoteResolved" in replicator && typeof replicator.markRemoteResolved === "function";
}

/**
 * Compose central compatibility recovery around the exact failed publication.
 * Remote mutations re-admit that publication and become no-ops after a
 * replacement; the failure result is never re-read from the current instance.
 */
export function createCentralCompatibilityRecovery(context: CentralCompatibilityRecoveryContext) {
    async function reconcileCleanedRemote(
        showProgress: boolean,
        setting: ObsidianLiveSyncSettings,
        expectedContext: ReplicationFailureRequest["context"]
    ) {
        Logger("The remote database has been cleaned.", showProgress ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        await skipIfDuplicated("cleanup", async () => {
            const count = await purgeUnreferencedChunks(context.getLocalDatabase().localDatabase, true);
            const message = `The remote database has been cleaned up.
To synchronize, this device must be also cleaned up. ${count} chunk(s) will be erased from this device.
However, If there are many chunks to be deleted, maybe fetching again is faster.
We will lose the history of this device if we fetch the remote database again.
Even if you choose to clean up, you will see this option again if you exit Obsidian and then synchronise again.`;
            const CHOICE_FETCH = "Fetch again";
            const CHOICE_CLEAN = "Cleanup";
            const CHOICE_DISMISS = "Dismiss";
            const selected = await context.confirm.confirmWithMessage(
                "Cleaned",
                message,
                [CHOICE_FETCH, CHOICE_CLEAN, CHOICE_DISMISS],
                CHOICE_DISMISS,
                30
            );
            if (selected == CHOICE_FETCH) {
                await context.rebuilder.$performRebuildDB("localOnly");
            }
            if (selected != CHOICE_CLEAN) return;

            await context.services.replicator.runBoundedRemoteActivity(
                () =>
                    context.services.replicator.runWithActiveReplicatorContext(async (activeContext) => {
                        if (activeContext !== expectedContext) return;
                        const replicator = activeContext.replicator;
                        if (!(replicator instanceof LiveSyncCouchDBReplicator)) return;
                        const localDatabase = context.getLocalDatabase();
                        const remoteDatabase = await replicator.connectRemoteCouchDBWithSetting(
                            setting,
                            context.services.API.isMobile(),
                            true
                        );
                        if (typeof remoteDatabase == "string") {
                            Logger(remoteDatabase, LOG_LEVEL_NOTICE);
                            return false;
                        }

                        try {
                            await purgeUnreferencedChunks(localDatabase.localDatabase, false);
                            localDatabase.clearCaches();
                            const replicated = await context.services.replicator.runFiniteReplicationActivity(
                                () => replicator.openOneShotReplication(setting, showProgress, false, "sync", true),
                                { label: "replication" }
                            );
                            if (replicated) {
                                await balanceChunkPurgedDBs(localDatabase.localDatabase, remoteDatabase.db);
                                await purgeUnreferencedChunks(localDatabase.localDatabase, false);
                                localDatabase.clearCaches();
                                await replicator.markRemoteResolved(setting);
                                Logger(
                                    "The local database has been cleaned up.",
                                    showProgress ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                                );
                            } else {
                                Logger(
                                    "Replication has been cancelled. Please try it again.",
                                    showProgress ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO
                                );
                            }
                        } finally {
                            await remoteDatabase.close();
                        }
                    }),
                { label: "database-cleanup" }
            );
        });
    }

    async function handleReplicationFailure(request: ReplicationFailureRequest): Promise<boolean> {
        const { context: failedContext, interaction, outcome, progressPresentation, setting } = request;
        const showProgress = progressPresentation === REPLICATION_PROGRESS_PRESENTATIONS.NOTICE;
        if (interaction.kind === "forbidden") {
            // Automatic requests may report the failure, but must not enter
            // tweak, lock, fetch, unlock, or cleanup dialogues.
            Logger("Replication failed on an unattended path.", LOG_LEVEL_INFO);
            return false;
        }
        if (!interaction.permissions.failureRecovery) return false;
        const recovery = outcome.recoveryHint;
        if (!recovery) return false;

        if (
            recovery.reason === CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH &&
            recovery.preferredTweakValue
        ) {
            await context.services.tweakValue.askResolvingMismatched(
                recovery.preferredTweakValue,
                async (effectiveSetting) => {
                    let updated = false;
                    await context.services.replicator.runWithActiveReplicatorContext(async (activeContext) => {
                        if (activeContext !== failedContext) return;
                        if (!canSetPreferredRemoteTweakSettings(activeContext.replicator)) return;
                        await activeContext.replicator.setPreferredRemoteTweakSettings({ ...effectiveSetting });
                        updated = true;
                    });
                    return updated;
                }
            );
            return false;
        }

        if (
            recovery.reason !== CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_LOCKED &&
            recovery.reason !== CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED
        ) {
            return false;
        }
        if (
            recovery.reason === CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED &&
            usesLegacyIndexedDBAdapter(setting)
        ) {
            await reconcileCleanedRemote(showProgress, setting, failedContext);
            return false;
        }

        const message = $msg("Replicator.Dialogue.Locked.Message");
        const CHOICE_FETCH = $msg("Replicator.Dialogue.Locked.Action.Fetch");
        const CHOICE_DISMISS = $msg("Replicator.Dialogue.Locked.Action.Dismiss");
        const CHOICE_UNLOCK = $msg("Replicator.Dialogue.Locked.Action.Unlock");
        const selected = await context.confirm.askSelectStringDialogue(
            message,
            [CHOICE_FETCH, CHOICE_UNLOCK, CHOICE_DISMISS],
            {
                title: $msg("Replicator.Dialogue.Locked.Title"),
                defaultAction: CHOICE_DISMISS,
                timeout: 60,
            }
        );
        if (selected == CHOICE_FETCH) {
            Logger($msg("Replicator.Dialogue.Locked.Message.Fetch"), LOG_LEVEL_NOTICE);
            await context.rebuilder.scheduleFetch();
            context.services.appLifecycle.scheduleRestart();
            return false;
        }
        if (selected != CHOICE_UNLOCK) return false;

        let unlocked = false;
        await context.services.replicator.runWithActiveReplicatorContext(async (activeContext) => {
            if (activeContext !== failedContext) return;
            if (!canMarkRemoteResolved(activeContext.replicator)) return;
            await activeContext.replicator.markRemoteResolved(setting);
            unlocked = true;
        });
        if (unlocked) {
            Logger($msg("Replicator.Dialogue.Locked.Message.Unlocked"), LOG_LEVEL_NOTICE);
        }
        return false;
    }

    return Object.freeze({ handleReplicationFailure, reconcileCleanedRemote });
}
