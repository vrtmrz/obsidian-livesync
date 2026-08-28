import { describe, expect, it, vi } from "vitest";
import { REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";
import {
    CAPABILITY_SUPPORT_KINDS,
    REMOTE_RESOURCE_KINDS,
    REPLACE_SAME_KIND_REPLICATOR,
} from "@vrtmrz/livesync-commonlib/replication";

const constructorMocks = vi.hoisted(() => ({
    couchDB: vi.fn(),
    objectStorage: vi.fn(),
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {
        constructor(host: unknown) {
            constructorMocks.couchDB(host);
        }
    },
}));
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator", () => ({
    LiveSyncJournalReplicator: class {
        constructor(host: unknown) {
            constructorMocks.objectStorage(host);
        }
    },
}));

import { createCentralReplicatorProviderDefinitions } from "./replicatorProviders";

describe("central Replicator provider definitions", () => {
    it("composes CouchDB and Object Storage policies outside LiveSyncBaseCore", async () => {
        const host = {} as Parameters<typeof createCentralReplicatorProviderDefinitions>[0];
        const definitions = createCentralReplicatorProviderDefinitions(host);
        const couchDB = definitions.get(REMOTE_COUCHDB)!;
        const objectStorage = definitions.get(REMOTE_MINIO)!;

        expect([...definitions.keys()]).toEqual([REMOTE_COUCHDB, REMOTE_MINIO]);
        expect(couchDB.sameKindReconciliation).toBe(REPLACE_SAME_KIND_REPLICATOR);
        expect(objectStorage.sameKindReconciliation).toBe(REPLACE_SAME_KIND_REPLICATOR);

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

    it("declares an exhaustive resource and administration catalogue for both central providers", () => {
        const definitions = createCentralReplicatorProviderDefinitions({} as never);
        const couchResources = definitions.get(REMOTE_COUCHDB)?.remoteResources;
        const objectResources = definitions.get(REMOTE_MINIO)?.remoteResources;

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
        expect(definitions.get(REMOTE_COUCHDB)?.remoteAdministration.kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
        expect(definitions.get(REMOTE_MINIO)?.remoteAdministration.kind).toBe(CAPABILITY_SUPPORT_KINDS.SUPPORTED);
    });
});
