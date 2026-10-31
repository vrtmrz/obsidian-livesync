import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { assessTweakCompatibility } from "@vrtmrz/livesync-commonlib/settings";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, Logger } from "octagonal-wheels/common/logger";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    type ReplicatorInstance,
    type ReplicationFailureRequest,
} from "@vrtmrz/livesync-commonlib/replication";
import { $msg } from "@/common/translation";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";

type CentralCompatibilityRecoveryServices = Pick<
    LiveSyncBaseCore["services"],
    "appLifecycle" | "replicator" | "setting" | "tweakValue"
>;

/** Collaborators for applying a compatibility decision to its failed publication. */
interface CentralCompatibilityRecoveryContext {
    readonly confirm: LiveSyncBaseCore["confirm"];
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
    async function handleReplicationFailure(request: ReplicationFailureRequest): Promise<boolean> {
        const { context: failedContext, interaction, outcome, setting } = request;
        if (interaction.kind === "forbidden") {
            // Automatic requests may report the failure, but must not enter
            // tweak, lock, fetch, or unlock dialogues.
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
            const isCurrent = await context.services.replicator.runWithActiveReplicatorContext(
                (activeContext) => activeContext === failedContext
            );
            // Compare in memory only: these snapshots can contain connection credentials.
            if (!isCurrent || JSON.stringify(setting) !== JSON.stringify(context.services.setting.currentSettings())) {
                return false;
            }
            const assessment =
                recovery.tweakAssessment ?? assessTweakCompatibility(setting, recovery.preferredTweakValue);
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
                },
                assessment
            );
            return false;
        }

        if (
            recovery.reason !== CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_LOCKED &&
            recovery.reason !== CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED
        ) {
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

    return Object.freeze({ handleReplicationFailure });
}
