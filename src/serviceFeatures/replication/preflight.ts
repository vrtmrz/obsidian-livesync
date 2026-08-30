import { $msg } from "@/common/translation";
import { withOwnedRemoteResource } from "@/common/ownedRemoteResource";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "octagonal-wheels/common/logger";
import { MARK_LOG_NETWORK_ERROR } from "@vrtmrz/livesync-commonlib/compat/services/lib/logUtils";
import { UnresolvedErrorManager } from "@vrtmrz/livesync-commonlib/compat/services/base/UnresolvedErrorManager";
import { REMOTE_RESOURCE_KINDS } from "@vrtmrz/livesync-commonlib/replication";
import type { LiveSyncBaseCore } from "@/LiveSyncBaseCore";

type ReplicationPreflightServices = Pick<LiveSyncBaseCore["services"], "API" | "replicator" | "setting">;

interface ReplicationPreflightContext {
    readonly services: ReplicationPreflightServices;
}

/** Return the generic online preflight without inspecting a provider kind. */
export function createOnlineReplicationPreflight(
    errorManager: UnresolvedErrorManager,
    context: ReplicationPreflightContext
) {
    return function isOnlineAndCanReplicate(showMessage: boolean): Promise<boolean> {
        const errorMessage = "Network is offline";
        if (!context.services.API.isOnline) {
            errorManager.showError(errorMessage, showMessage ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
            return Promise.resolve(false);
        }
        errorManager.clearError(errorMessage);
        return Promise.resolve(true);
    };
}

/**
 * Return the central-remote Security Seed preflight. The acquired resource is
 * owned only for this read and is disposed before the handler settles.
 */
export function createSecuritySeedPreflight(
    errorManager: UnresolvedErrorManager,
    context: ReplicationPreflightContext
) {
    return async function canReplicateWithSecuritySeed(showMessage: boolean): Promise<boolean> {
        const currentSettings = context.services.setting.currentSettings();
        const errorMessage = $msg("Replicator.Message.InitialiseFatalError");
        // This is a fatal preparation error, so the non-interactive path still
        // records it while choosing a quieter log level.
        const ensureMessage = `${MARK_LOG_NETWORK_ERROR}Failed to initialise the encryption key, preventing replication.`;
        try {
            const resource = await context.services.replicator.createRemoteResource(
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
    };
}
