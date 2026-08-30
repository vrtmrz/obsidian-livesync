import { REMOTE_COUCHDB, REMOTE_MINIO, type RemoteDBSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    CAPABILITY_NOT_APPLICABLE,
    CENTRAL_REMOTE_REPLICATION_READINESS,
    NO_INTERACTION,
    REMOTE_RESOURCE_KINDS,
    defineReplicatorProviderDefinitions,
    supportedOpenReplicationContinuous,
    replicationBlocked,
    replicationFailed,
    supportedStopActiveTransfer,
    supportedCapability,
    type ReplicatorProviderDefinitionMap,
    type ReplicationOutcome,
    type ReplicatorInstance,
    type UserInitiatedOneShotRunner,
    type UnattendedOneShotRunner,
} from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import {
    getCouchDBReplicatorConfigurationIdentity,
    getObjectStorageReplicatorConfigurationIdentity,
} from "./replicatorConfigurationIdentity";
import {
    createCouchDBConnectionProbeFactory,
    createCouchDBPreferredTweakProbeFactory,
    createCouchDBSecuritySeedResourceFactory,
    createCouchDBSynchronisationInformationResourceFactory,
    createObjectStorageConnectionProbeFactory,
    createObjectStoragePreferredTweakProbeFactory,
    createObjectStorageSecuritySeedResourceFactory,
} from "./replicatorResources";
import {
    COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY,
    OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY,
} from "./centralRemoteAdministration";

/** Host environment sufficient to construct every current central provider. */
export type CentralReplicatorProviderHost = LiveSyncCouchDBReplicatorEnv;

/** Minimal operation required by both central one-shot adapters. */
interface OneShotOutcomeReplicator extends ReplicatorInstance {
    openOneShotReplicationWithOutcome(setting: RemoteDBSettings, showResult: boolean): Promise<ReplicationOutcome>;
}

function isOneShotOutcomeReplicator(instance: ReplicatorInstance): instance is OneShotOutcomeReplicator {
    return (
        "openOneShotReplicationWithOutcome" in instance &&
        typeof instance.openOneShotReplicationWithOutcome === "function"
    );
}

async function runOneShotWithOutcome(
    instance: ReplicatorInstance,
    setting: RemoteDBSettings,
    showResult: boolean
): Promise<ReplicationOutcome> {
    if (!isOneShotOutcomeReplicator(instance)) {
        return replicationFailed(new Error("The configured provider does not implement one-shot replication."));
    }
    return await instance.openOneShotReplicationWithOutcome(setting, showResult);
}

const couchDBUserInitiatedOneShot: UserInitiatedOneShotRunner = async (instance, setting, request) => {
    return await runOneShotWithOutcome(
        instance,
        setting,
        request.interaction.kind === "permitted" && request.interaction.permissions.failureRecovery
    );
};

const couchDBUnattendedOneShot: UnattendedOneShotRunner = async (instance, setting, request) => {
    if (request.interaction.kind !== NO_INTERACTION.kind) return replicationBlocked("interaction-required");
    return await runOneShotWithOutcome(instance, setting, false);
};

const objectStorageUserInitiatedOneShot: UserInitiatedOneShotRunner = async (instance, setting, request) => {
    return await runOneShotWithOutcome(
        instance,
        setting,
        request.interaction.kind === "permitted" && request.interaction.permissions.failureRecovery
    );
};

const objectStorageUnattendedOneShot: UnattendedOneShotRunner = async (instance, setting, request) => {
    if (request.interaction.kind !== NO_INTERACTION.kind) return replicationBlocked("interaction-required");
    return await runOneShotWithOutcome(instance, setting, false);
};

/** Build the complete central-remote provider policy for one LiveSync host. */
export function createCentralReplicatorProviderDefinitions(
    host: CentralReplicatorProviderHost
): ReplicatorProviderDefinitionMap {
    return defineReplicatorProviderDefinitions([REMOTE_COUCHDB, REMOTE_MINIO] as const, {
        [REMOTE_COUCHDB]: {
            kind: REMOTE_COUCHDB,
            diagnosticName: "CouchDB",
            readiness: CENTRAL_REMOTE_REPLICATION_READINESS,
            isConfigured: (settings) =>
                settings.remoteType === REMOTE_COUCHDB &&
                !!settings.couchDB_URI?.trim() &&
                !!settings.couchDB_DBNAME?.trim(),
            configurationIdentity: getCouchDBReplicatorConfigurationIdentity,
            create: () => Promise.resolve(new LiveSyncCouchDBReplicator(host)),
            remoteResources: {
                [REMOTE_RESOURCE_KINDS.CONNECTION]: supportedCapability(createCouchDBConnectionProbeFactory(host)),
                [REMOTE_RESOURCE_KINDS.PREFERRED_TWEAK]: supportedCapability(
                    createCouchDBPreferredTweakProbeFactory(host)
                ),
                [REMOTE_RESOURCE_KINDS.SECURITY_SEED]: supportedCapability(
                    createCouchDBSecuritySeedResourceFactory(host)
                ),
                [REMOTE_RESOURCE_KINDS.SYNCHRONISATION_INFORMATION]: supportedCapability(
                    createCouchDBSynchronisationInformationResourceFactory(host)
                ),
            },
            centralRemoteAdministration: COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY,
            userInitiatedOneShot: supportedCapability(couchDBUserInitiatedOneShot),
            unattendedOneShot: supportedCapability(couchDBUnattendedOneShot),
            continuous: supportedOpenReplicationContinuous(),
            stopActiveTransfer: supportedStopActiveTransfer(),
        },
        [REMOTE_MINIO]: {
            kind: REMOTE_MINIO,
            diagnosticName: "Object Storage",
            readiness: CENTRAL_REMOTE_REPLICATION_READINESS,
            isConfigured: (settings) =>
                settings.remoteType === REMOTE_MINIO && !!settings.endpoint?.trim() && !!settings.bucket?.trim(),
            configurationIdentity: getObjectStorageReplicatorConfigurationIdentity,
            create: () => Promise.resolve(new LiveSyncJournalReplicator(host)),
            remoteResources: {
                [REMOTE_RESOURCE_KINDS.CONNECTION]: supportedCapability(
                    createObjectStorageConnectionProbeFactory(host)
                ),
                [REMOTE_RESOURCE_KINDS.PREFERRED_TWEAK]: supportedCapability(
                    createObjectStoragePreferredTweakProbeFactory(host)
                ),
                [REMOTE_RESOURCE_KINDS.SECURITY_SEED]: supportedCapability(
                    createObjectStorageSecuritySeedResourceFactory(host)
                ),
                [REMOTE_RESOURCE_KINDS.SYNCHRONISATION_INFORMATION]: CAPABILITY_NOT_APPLICABLE,
            },
            centralRemoteAdministration: OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY,
            userInitiatedOneShot: supportedCapability(objectStorageUserInitiatedOneShot),
            unattendedOneShot: supportedCapability(objectStorageUnattendedOneShot),
            continuous: CAPABILITY_NOT_APPLICABLE,
            stopActiveTransfer: supportedStopActiveTransfer(),
        },
    });
}
