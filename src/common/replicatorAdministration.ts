import {
    MILESTONE_DOCID,
    type EntryMilestoneInfo,
    type RemoteDBSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncAbstractReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/LiveSyncAbstractReplicator";
import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import {
    REMOTE_ADMINISTRATION_FAILURE_REASONS,
    REMOTE_ADMINISTRATION_OBSERVATION_KINDS,
    applyRemoteAdministrationMutation,
    milestoneSatisfiesRemoteAdministration,
    remoteAdministrationVerificationFailed,
    remoteAdministrationVerified,
    supportedCapability,
    type MilestoneRemoteAdministrationObservation,
    type RemoteAdministrationRequest,
    type RemoteAdministrationResult,
    type SupportedCapability,
    type RemoteAdministrationRunner,
} from "@vrtmrz/livesync-commonlib/replication";

const JOURNAL_MILESTONE_PATH = "_00000000-milestone.json";

async function ensureLocalNodeIdentity(
    replicator: LiveSyncAbstractReplicator
): Promise<RemoteAdministrationResult | undefined> {
    if (replicator.nodeid) {
        return undefined;
    }
    if ((await replicator.initializeDatabaseForReplication()) && replicator.nodeid) {
        return undefined;
    }
    return remoteAdministrationVerificationFailed(REMOTE_ADMINISTRATION_FAILURE_REASONS.LOCAL_IDENTITY_UNAVAILABLE);
}

function observeMilestone(
    replicator: LiveSyncAbstractReplicator,
    milestone: EntryMilestoneInfo
): MilestoneRemoteAdministrationObservation {
    return {
        kind: REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE,
        locked: !!milestone.locked,
        accepted: !!milestone.accepted_nodes?.includes(replicator.nodeid),
        nodeId: replicator.nodeid,
    };
}

function resultFromMilestone(
    replicator: LiveSyncAbstractReplicator,
    request: RemoteAdministrationRequest,
    milestone: EntryMilestoneInfo | false | undefined
): RemoteAdministrationResult {
    if (!milestone) {
        return remoteAdministrationVerificationFailed(REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_NOT_FOUND);
    }
    const observation = observeMilestone(replicator, milestone);
    return milestoneSatisfiesRemoteAdministration(request.action, observation)
        ? remoteAdministrationVerified(observation)
        : remoteAdministrationVerificationFailed(REMOTE_ADMINISTRATION_FAILURE_REASONS.POSTCONDITION_MISMATCH, {
              observation,
          });
}

async function runCouchDBRemoteAdministration(
    replicator: LiveSyncAbstractReplicator,
    setting: RemoteDBSettings,
    request: RemoteAdministrationRequest
): Promise<RemoteAdministrationResult> {
    const identityFailure = await ensureLocalNodeIdentity(replicator);
    if (identityFailure) return identityFailure;

    await applyRemoteAdministrationMutation(replicator, setting, request.action);

    const couchDBReplicator = replicator as LiveSyncCouchDBReplicator;
    let connection;
    try {
        connection = await couchDBReplicator.connectRemoteCouchDBWithSetting(
            setting,
            couchDBReplicator.isMobile(),
            true
        );
    } catch (error) {
        return remoteAdministrationVerificationFailed(REMOTE_ADMINISTRATION_FAILURE_REASONS.CONNECTION_FAILED, {
            detail: error,
        });
    }
    if (typeof connection === "string") {
        return remoteAdministrationVerificationFailed(REMOTE_ADMINISTRATION_FAILURE_REASONS.CONNECTION_FAILED, {
            detail: connection,
        });
    }

    let milestone: EntryMilestoneInfo | undefined;
    let observationError: unknown;
    try {
        milestone = await connection.db.get<EntryMilestoneInfo>(MILESTONE_DOCID);
    } catch (error) {
        observationError = error;
    }
    try {
        await connection.close();
    } catch (error) {
        observationError ??= error;
    }
    if (observationError !== undefined) {
        return remoteAdministrationVerificationFailed(REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_READ_FAILED, {
            detail: observationError,
        });
    }
    return resultFromMilestone(replicator, request, milestone);
}

async function runObjectStorageRemoteAdministration(
    replicator: LiveSyncAbstractReplicator,
    setting: RemoteDBSettings,
    request: RemoteAdministrationRequest
): Promise<RemoteAdministrationResult> {
    const identityFailure = await ensureLocalNodeIdentity(replicator);
    if (identityFailure) return identityFailure;

    await applyRemoteAdministrationMutation(replicator, setting, request.action);

    const journalReplicator = replicator as LiveSyncJournalReplicator;
    let milestone: EntryMilestoneInfo | false | undefined;
    try {
        milestone = await journalReplicator.client.downloadJson<EntryMilestoneInfo>(JOURNAL_MILESTONE_PATH);
    } catch (error) {
        return remoteAdministrationVerificationFailed(REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_READ_FAILED, {
            detail: error,
        });
    }
    return resultFromMilestone(replicator, request, milestone);
}

/** CouchDB mutation and milestone postcondition verification capability. */
export const COUCHDB_REMOTE_ADMINISTRATION_CAPABILITY: SupportedCapability<RemoteAdministrationRunner> =
    supportedCapability(runCouchDBRemoteAdministration);

/** Object Storage mutation and milestone postcondition verification capability. */
export const OBJECT_STORAGE_REMOTE_ADMINISTRATION_CAPABILITY: SupportedCapability<RemoteAdministrationRunner> =
    supportedCapability(runObjectStorageRemoteAdministration);
