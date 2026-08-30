import {
    MILESTONE_DOCID,
    type EntryMilestoneInfo,
    type RemoteDBSettings,
} from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import type { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import {
    CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS,
    CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS,
    applyCentralRemoteAdministrationMutation,
    milestoneSatisfiesCentralRemoteAdministration,
    centralRemoteAdministrationVerificationFailed,
    centralRemoteAdministrationVerified,
    supportedCapability,
    type MilestoneCentralRemoteAdministrationObservation,
    type CentralRemoteAdministrationFailureReason,
    type CentralRemoteAdministrationRequest,
    type CentralRemoteAdministrationReplicator,
    type CentralRemoteAdministrationResult,
    type CentralRemoteAdministrationRunner,
    type SupportedCapability,
} from "@vrtmrz/livesync-commonlib/replication";

const JOURNAL_MILESTONE_PATH = "_00000000-milestone.json";

type CentralMilestoneReadResult =
    | { readonly milestone: EntryMilestoneInfo | false | undefined }
    | { readonly failureReason: CentralRemoteAdministrationFailureReason; readonly detail?: unknown };

type PreparedCentralMilestoneReader = () => Promise<CentralMilestoneReadResult>;

type CentralMilestoneReaderPreparer = (
    replicator: CentralRemoteAdministrationReplicator,
    setting: RemoteDBSettings
) => PreparedCentralMilestoneReader;

type CouchDBAdministrationReplicator = CentralRemoteAdministrationReplicator &
    Pick<LiveSyncCouchDBReplicator, "connectRemoteCouchDBWithSetting" | "isMobile">;

type JournalAdministrationClient = Pick<LiveSyncJournalReplicator["client"], "downloadJson">;

async function ensureLocalNodeIdentity(
    replicator: CentralRemoteAdministrationReplicator
): Promise<CentralRemoteAdministrationResult | undefined> {
    if (replicator.nodeid) {
        return undefined;
    }
    if ((await replicator.initializeDatabaseForReplication()) && replicator.nodeid) {
        return undefined;
    }
    return centralRemoteAdministrationVerificationFailed(
        CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.LOCAL_IDENTITY_UNAVAILABLE
    );
}

function observeMilestone(
    replicator: CentralRemoteAdministrationReplicator,
    milestone: EntryMilestoneInfo
): MilestoneCentralRemoteAdministrationObservation {
    return {
        kind: CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE,
        locked: !!milestone.locked,
        accepted: !!milestone.accepted_nodes?.includes(replicator.nodeid),
        nodeId: replicator.nodeid,
    };
}

function resultFromMilestone(
    replicator: CentralRemoteAdministrationReplicator,
    request: CentralRemoteAdministrationRequest,
    milestone: EntryMilestoneInfo | false | undefined
): CentralRemoteAdministrationResult {
    if (!milestone) {
        return centralRemoteAdministrationVerificationFailed(
            CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_NOT_FOUND
        );
    }
    const observation = observeMilestone(replicator, milestone);
    return milestoneSatisfiesCentralRemoteAdministration(request.action, observation)
        ? centralRemoteAdministrationVerified(observation)
        : centralRemoteAdministrationVerificationFailed(
              CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.POSTCONDITION_MISMATCH,
              {
                  observation,
              }
          );
}

/**
 * Apply and verify the central milestone protocol without selecting a provider.
 *
 * The provider definition has already selected the reader preparer. Preparing
 * it before mutation rejects incomplete composition before a remote write and
 * binds any provider-owned client which must be used for postcondition reading.
 */
async function runCentralRemoteAdministration(
    replicator: CentralRemoteAdministrationReplicator,
    setting: RemoteDBSettings,
    request: CentralRemoteAdministrationRequest,
    prepareMilestoneReader: CentralMilestoneReaderPreparer
): Promise<CentralRemoteAdministrationResult> {
    const identityFailure = await ensureLocalNodeIdentity(replicator);
    if (identityFailure) return identityFailure;

    const readMilestone = prepareMilestoneReader(replicator, setting);
    await applyCentralRemoteAdministrationMutation(replicator, setting, request.action);

    const readResult = await readMilestone();
    if ("failureReason" in readResult) {
        return centralRemoteAdministrationVerificationFailed(readResult.failureReason, { detail: readResult.detail });
    }
    return resultFromMilestone(replicator, request, readResult.milestone);
}

function requireCouchDBAdministrationOperations(
    replicator: CentralRemoteAdministrationReplicator
): asserts replicator is CouchDBAdministrationReplicator {
    const candidate = replicator as Partial<CouchDBAdministrationReplicator>;
    if (typeof candidate.connectRemoteCouchDBWithSetting !== "function" || typeof candidate.isMobile !== "function") {
        throw new Error("The configured CouchDB administration adapter does not provide milestone access.");
    }
}

function prepareCouchDBMilestoneReader(
    replicator: CentralRemoteAdministrationReplicator,
    setting: RemoteDBSettings
): PreparedCentralMilestoneReader {
    requireCouchDBAdministrationOperations(replicator);

    return async () => {
        let connection: Awaited<ReturnType<CouchDBAdministrationReplicator["connectRemoteCouchDBWithSetting"]>>;
        try {
            connection = await replicator.connectRemoteCouchDBWithSetting(setting, replicator.isMobile(), true);
        } catch (error) {
            return { failureReason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.CONNECTION_FAILED, detail: error };
        }
        if (typeof connection === "string") {
            return {
                failureReason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.CONNECTION_FAILED,
                detail: connection,
            };
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
            return {
                failureReason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_READ_FAILED,
                detail: observationError,
            };
        }
        return { milestone };
    };
}

function requireJournalAdministrationClient(
    replicator: CentralRemoteAdministrationReplicator
): JournalAdministrationClient {
    const client = (replicator as { readonly client?: JournalAdministrationClient }).client;
    if (typeof client?.downloadJson !== "function") {
        throw new Error("The configured Object Storage administration adapter does not provide milestone access.");
    }
    return client;
}

function prepareObjectStorageMilestoneReader(
    replicator: CentralRemoteAdministrationReplicator
): PreparedCentralMilestoneReader {
    const client = requireJournalAdministrationClient(replicator);

    return async () => {
        try {
            return { milestone: await client.downloadJson<EntryMilestoneInfo>(JOURNAL_MILESTONE_PATH) };
        } catch (error) {
            return {
                failureReason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_READ_FAILED,
                detail: error,
            };
        }
    };
}

const runCouchDBCentralRemoteAdministration: CentralRemoteAdministrationRunner = async (replicator, setting, request) =>
    await runCentralRemoteAdministration(replicator, setting, request, prepareCouchDBMilestoneReader);

const runObjectStorageCentralRemoteAdministration: CentralRemoteAdministrationRunner = async (
    replicator,
    setting,
    request
) => await runCentralRemoteAdministration(replicator, setting, request, prepareObjectStorageMilestoneReader);

/** CouchDB mutation and milestone postcondition verification capability. */
export const COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY: SupportedCapability<CentralRemoteAdministrationRunner> =
    supportedCapability(runCouchDBCentralRemoteAdministration);

/** Object Storage mutation and milestone postcondition verification capability. */
export const OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY: SupportedCapability<CentralRemoteAdministrationRunner> =
    supportedCapability(runObjectStorageCentralRemoteAdministration);
