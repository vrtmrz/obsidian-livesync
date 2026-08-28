import { REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    CAPABILITY_NOT_APPLICABLE,
    CENTRAL_REMOTE_REPLICATION_READINESS,
    REMOTE_RESOURCE_KINDS,
    REPLACE_SAME_KIND_REPLICATOR,
    defineReplicatorProviderDefinitions,
    supportedOpenReplicationContinuous,
    supportedOpenReplicationOneShot,
    supportedOpenReplicationUnattended,
    supportedStopActiveTransfer,
    supportedCapability,
    type ReplicatorProviderDefinitionMap,
} from "@vrtmrz/livesync-commonlib/replication";
import {
    LiveSyncCouchDBReplicator,
    type LiveSyncCouchDBReplicatorEnv,
} from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator";
import type { LiveSyncJournalReplicatorEnv } from "@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicatorEnv";
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
    COUCHDB_REMOTE_ADMINISTRATION_CAPABILITY,
    OBJECT_STORAGE_REMOTE_ADMINISTRATION_CAPABILITY,
} from "./replicatorAdministration";

export type CentralReplicatorProviderHost = LiveSyncCouchDBReplicatorEnv & LiveSyncJournalReplicatorEnv;

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
            sameKindReconciliation: REPLACE_SAME_KIND_REPLICATOR,
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
            remoteAdministration: COUCHDB_REMOTE_ADMINISTRATION_CAPABILITY,
            userInitiatedOneShot: supportedOpenReplicationOneShot(),
            unattendedOneShot: supportedOpenReplicationUnattended(),
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
            sameKindReconciliation: REPLACE_SAME_KIND_REPLICATOR,
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
            remoteAdministration: OBJECT_STORAGE_REMOTE_ADMINISTRATION_CAPABILITY,
            userInitiatedOneShot: supportedOpenReplicationOneShot(),
            unattendedOneShot: supportedOpenReplicationUnattended(),
            continuous: CAPABILITY_NOT_APPLICABLE,
            stopActiveTransfer: supportedStopActiveTransfer(),
        },
    });
}
