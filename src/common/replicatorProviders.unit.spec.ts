import { describe, expect, it, vi } from "vitest";
import { REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import {
    CAPABILITY_SUPPORT_KINDS,
    NO_INTERACTION,
    REPLICATION_COMPLETED,
    REMOTE_RESOURCE_KINDS,
    USER_INITIATED_REPLICATION_AUTHORITY,
} from "@vrtmrz/livesync-commonlib/replication";

const constructorMocks = vi.hoisted(() => ({
    couchDB: vi.fn(),
    couchDBOneShot: vi.fn(async (..._args: unknown[]) => REPLICATION_COMPLETED),
    objectStorage: vi.fn(),
    objectStorageOneShot: vi.fn(async (..._args: unknown[]) => REPLICATION_COMPLETED),
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {
        constructor(host: unknown) {
            constructorMocks.couchDB(host);
        }
        openOneShotReplicationWithOutcome(...args: unknown[]) {
            return constructorMocks.couchDBOneShot(...args);
        }
    },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator", () => ({
    LiveSyncJournalReplicator: class {
        constructor(host: unknown) {
            constructorMocks.objectStorage(host);
        }
        openOneShotReplicationWithOutcome(...args: unknown[]) {
            return constructorMocks.objectStorageOneShot(...args);
        }
    },
}));

import { createCentralReplicatorProviderDefinitions } from "./replicatorProviders";

describe("central Replicator provider definitions", () => {
    it("keeps the retained remote-resource catalogue bounded", () => {
        expect
            .soft(Object.values(REMOTE_RESOURCE_KINDS).sort())
            .toEqual(["connection", "preferred-tweak", "security-seed", "synchronisation-information"].sort());
    });

    it("composes CouchDB and Object Storage policies outside LiveSyncBaseCore", async () => {
        const host = {} as Parameters<typeof createCentralReplicatorProviderDefinitions>[0];
        const definitions = createCentralReplicatorProviderDefinitions(host);
        const couchDB = definitions.get(REMOTE_COUCHDB)!;
        const objectStorage = definitions.get(REMOTE_MINIO)!;

        expect([...definitions.keys()]).toEqual([REMOTE_COUCHDB, REMOTE_MINIO]);
        expect("sameKindReconciliation" in couchDB).toBe(false);
        expect("sameKindReconciliation" in objectStorage).toBe(false);

        expect(
            couchDB.isConfigured(
                Object.assign(createNewVaultSettings(), {
                    remoteType: REMOTE_COUCHDB,
                    couchDB_URI: "https://couch.example.test",
                    couchDB_DBNAME: "vault",
                })
            )
        ).toBe(true);
        expect(
            objectStorage.isConfigured(
                Object.assign(createNewVaultSettings(), {
                    remoteType: REMOTE_MINIO,
                    endpoint: "https://objects.example.test",
                    bucket: "vault",
                })
            )
        ).toBe(true);

        await couchDB.create(createNewVaultSettings());
        await objectStorage.create(createNewVaultSettings());
        expect(constructorMocks.couchDB).toHaveBeenCalledWith(host);
        expect(constructorMocks.objectStorage).toHaveBeenCalledWith(host);
    });

    it("rejects incomplete and wrong-kind settings before construction", () => {
        const definitions = createCentralReplicatorProviderDefinitions({} as never);
        const couchDB = definitions.get(REMOTE_COUCHDB)!;
        const objectStorage = definitions.get(REMOTE_MINIO)!;

        expect(couchDB.isConfigured(Object.assign(createNewVaultSettings(), { remoteType: REMOTE_MINIO }))).toBe(false);
        expect(
            objectStorage.isConfigured(Object.assign(createNewVaultSettings(), { remoteType: REMOTE_COUCHDB }))
        ).toBe(false);
    });

    it("declares the retained owned resources and cohesive optional administration", () => {
        const definitions = createCentralReplicatorProviderDefinitions({} as never);
        const couchResources = definitions.get(REMOTE_COUCHDB)?.remoteResources;
        const objectResources = definitions.get(REMOTE_MINIO)?.remoteResources;
        const couchAdministration = definitions.get(REMOTE_COUCHDB)?.centralRemoteAdministration;
        const objectAdministration = definitions.get(REMOTE_MINIO)?.centralRemoteAdministration;

        expect(Object.keys(couchResources ?? {}).sort()).toEqual(Object.values(REMOTE_RESOURCE_KINDS).sort());
        expect(Object.keys(objectResources ?? {}).sort()).toEqual(Object.values(REMOTE_RESOURCE_KINDS).sort());
        expect(couchResources?.[REMOTE_RESOURCE_KINDS.CONNECTION].kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
        expect(couchResources?.[REMOTE_RESOURCE_KINDS.PREFERRED_TWEAK].kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
        expect(couchResources?.[REMOTE_RESOURCE_KINDS.SECURITY_SEED].kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
        expect(couchResources?.[REMOTE_RESOURCE_KINDS.SYNCHRONISATION_INFORMATION].kind).toBe(
            CAPABILITY_SUPPORT_KINDS.SUPPORTED
        );
        expect(objectResources?.[REMOTE_RESOURCE_KINDS.SECURITY_SEED].kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
        expect(objectResources?.[REMOTE_RESOURCE_KINDS.SYNCHRONISATION_INFORMATION].kind).toBe(
            CAPABILITY_SUPPORT_KINDS.NOT_APPLICABLE
        );
        expect(couchAdministration?.kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
        expect(objectAdministration?.kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
        expect("activeRemoteReads" in definitions.get(REMOTE_COUCHDB)!).toBe(false);
        expect("fullTransfers" in definitions.get(REMOTE_COUCHDB)!).toBe(false);
    });

    it("dispatches central finite work through provider-local attempt results", async () => {
        const definitions = createCentralReplicatorProviderDefinitions({} as never);
        const couchDB = definitions.get(REMOTE_COUCHDB)!;
        const objectStorage = definitions.get(REMOTE_MINIO)!;
        const setting = createNewVaultSettings();
        const couchInstance = await couchDB.create(setting);
        const objectInstance = await objectStorage.create(setting);
        if (!couchInstance || !objectInstance) throw new Error("Provider construction failed");
        if (couchDB.userInitiatedOneShot.kind !== CAPABILITY_SUPPORT_KINDS.SUPPORTED) {
            throw new Error("CouchDB OneShot is unavailable");
        }
        if (objectStorage.unattendedOneShot.kind !== CAPABILITY_SUPPORT_KINDS.SUPPORTED) {
            throw new Error("Object Storage OneShot is unavailable");
        }

        await expect(
            couchDB.userInitiatedOneShot.run(couchInstance, setting, {
                trigger: "manual",
                interaction: USER_INITIATED_REPLICATION_AUTHORITY,
            })
        ).resolves.toBe(REPLICATION_COMPLETED);
        await expect(
            objectStorage.unattendedOneShot.run(objectInstance, setting, {
                trigger: "resume",
                interaction: NO_INTERACTION,
            })
        ).resolves.toBe(REPLICATION_COMPLETED);

        expect(constructorMocks.couchDBOneShot).toHaveBeenCalledWith(setting, true);
        expect(constructorMocks.objectStorageOneShot).toHaveBeenCalledWith(setting, false);
    });

    it("dispatches central finite work through the declared operation rather than constructor identity", async () => {
        const definitions = createCentralReplicatorProviderDefinitions({} as never);
        const couchDB = definitions.get(REMOTE_COUCHDB)!;
        const objectStorage = definitions.get(REMOTE_MINIO)!;
        const setting = createNewVaultSettings();
        const createStructuralOneShotReplicator = () => ({
            initializeDatabaseForReplication: vi.fn(async () => true),
            openReplication: vi.fn(async () => true),
            terminateSync: vi.fn(),
            closeReplication: vi.fn(),
            openOneShotReplicationWithOutcome: vi.fn(async () => REPLICATION_COMPLETED),
        });
        const couchInstance = createStructuralOneShotReplicator();
        const objectStorageInstance = createStructuralOneShotReplicator();
        if (couchDB.userInitiatedOneShot.kind !== CAPABILITY_SUPPORT_KINDS.SUPPORTED) {
            throw new Error("CouchDB OneShot is unavailable");
        }
        if (objectStorage.unattendedOneShot.kind !== CAPABILITY_SUPPORT_KINDS.SUPPORTED) {
            throw new Error("Object Storage OneShot is unavailable");
        }

        const couchOutcome = await couchDB.userInitiatedOneShot.run(couchInstance, setting, {
            trigger: "manual",
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
        const objectStorageOutcome = await objectStorage.unattendedOneShot.run(objectStorageInstance, setting, {
            trigger: "resume",
            interaction: NO_INTERACTION,
        });

        expect.soft(couchOutcome).toBe(REPLICATION_COMPLETED);
        expect.soft(objectStorageOutcome).toBe(REPLICATION_COMPLETED);
        expect(couchInstance.openOneShotReplicationWithOutcome).toHaveBeenCalledWith(setting, true);
        expect(objectStorageInstance.openOneShotReplicationWithOutcome).toHaveBeenCalledWith(setting, false);
    });

    it("rejects a one-shot adapter whose Replicator does not declare the required operation", async () => {
        const definitions = createCentralReplicatorProviderDefinitions({} as never);
        const couchDB = definitions.get(REMOTE_COUCHDB)!;
        const setting = createNewVaultSettings();
        const incompleteInstance = {
            initializeDatabaseForReplication: vi.fn(async () => true),
            openReplication: vi.fn(async () => true),
            terminateSync: vi.fn(),
            closeReplication: vi.fn(),
        };
        if (couchDB.userInitiatedOneShot.kind !== CAPABILITY_SUPPORT_KINDS.SUPPORTED) {
            throw new Error("CouchDB OneShot is unavailable");
        }

        const outcome = await couchDB.userInitiatedOneShot.run(incompleteInstance, setting, {
            trigger: "manual",
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });

        expect(outcome.status).toBe("failed");
        expect(incompleteInstance.openReplication).not.toHaveBeenCalled();
    });
});
