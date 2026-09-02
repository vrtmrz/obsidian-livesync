import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOG_LEVEL_NOTICE, REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { createNewVaultSettings } from "@vrtmrz/livesync-commonlib/settings";

const mocks = vi.hoisted(() => ({
    logger: vi.fn(),
    couchDB: [] as Array<{
        host: unknown;
        isMobile: ReturnType<typeof vi.fn>;
        connectRemoteCouchDBWithSetting: ReturnType<typeof vi.fn>;
        getRemoteStatus: ReturnType<typeof vi.fn>;
        getRemotePreferredTweakValues: ReturnType<typeof vi.fn>;
        getReplicationPBKDF2Salt: ReturnType<typeof vi.fn>;
        closeReplication: ReturnType<typeof vi.fn>;
    }>,
    objectStorage: [] as Array<{
        host: unknown;
        tryConnectRemote: ReturnType<typeof vi.fn>;
        getRemoteStatus: ReturnType<typeof vi.fn>;
        getRemotePreferredTweakValues: ReturnType<typeof vi.fn>;
        getReplicationPBKDF2Salt: ReturnType<typeof vi.fn>;
        closeReplication: ReturnType<typeof vi.fn>;
    }>,
    checkSyncInfo: vi.fn(async () => true),
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/common/logger", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@vrtmrz/livesync-commonlib/compat/common/logger")>();
    return { ...actual, Logger: mocks.logger };
});

vi.mock("@vrtmrz/livesync-commonlib/compat/pouchdb/negotiation", () => ({
    checkSyncInfo: mocks.checkSyncInfo,
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {
        host: unknown;
        isMobile = vi.fn(() => false);
        connectRemoteCouchDBWithSetting = vi.fn();
        getRemoteStatus = vi.fn();
        getRemotePreferredTweakValues = vi.fn();
        getReplicationPBKDF2Salt = vi.fn();
        closeReplication = vi.fn();

        constructor(host: unknown) {
            this.host = host;
            mocks.couchDB.push(this);
        }
    },
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/replication/journal/LiveSyncJournalReplicator", () => ({
    LiveSyncJournalReplicator: class {
        host: unknown;
        tryConnectRemote = vi.fn();
        getRemoteStatus = vi.fn();
        getRemotePreferredTweakValues = vi.fn();
        getReplicationPBKDF2Salt = vi.fn();
        closeReplication = vi.fn();

        constructor(host: unknown) {
            this.host = host;
            mocks.objectStorage.push(this);
        }
    },
}));

import {
    createCouchDBConnectionProbeFactory,
    createCouchDBPreferredTweakProbeFactory,
    createCouchDBSecuritySeedResourceFactory,
    createCouchDBSynchronisationInformationResourceFactory,
    createObjectStorageConnectionProbeFactory,
    createObjectStoragePreferredTweakProbeFactory,
    createObjectStorageSecuritySeedResourceFactory,
} from "./replicatorResources";

function createSettings(overrides: Partial<ObsidianLiveSyncSettings> = {}): ObsidianLiveSyncSettings {
    return Object.assign(createNewVaultSettings(), {
        remoteType: REMOTE_COUCHDB,
        couchDB_URI: "https://couch.example.test",
        couchDB_DBNAME: "vault",
        endpoint: "https://objects.example.test",
        bucket: "vault",
        ...overrides,
    });
}

describe("replicator probe factories", () => {
    beforeEach(() => {
        mocks.couchDB.length = 0;
        mocks.objectStorage.length = 0;
        mocks.checkSyncInfo.mockReset().mockResolvedValue(true);
        mocks.logger.mockClear();
    });

    it("binds a CouchDB connection probe to a shallow settings snapshot and closes its owned connection", async () => {
        const host = { name: "host" };
        const source = createSettings();
        const snapshot = { ...source };
        const probe = await createCouchDBConnectionProbeFactory(host as never)(source);
        const replicator = mocks.couchDB[0];
        const close = vi.fn(async () => undefined);
        const databaseClose = vi.fn(async () => undefined);
        replicator.isMobile.mockReturnValue(true);
        replicator.connectRemoteCouchDBWithSetting.mockResolvedValue({
            db: { close: databaseClose },
            info: {},
            close,
        });

        source.couchDB_URI = "https://changed.example.test";
        expect(await probe.check({ createIfMissing: false, showResult: true })).toEqual({ ok: true });

        expect(replicator.connectRemoteCouchDBWithSetting).toHaveBeenCalledWith(snapshot, true, false, false);
        expect(replicator.connectRemoteCouchDBWithSetting.mock.calls[0][0]).not.toBe(source);
        expect(close).toHaveBeenCalledOnce();
        expect(databaseClose).not.toHaveBeenCalled();
    });

    it("maps a CouchDB connection error string and delegates status to the same snapshot", async () => {
        const source = createSettings();
        const snapshot = { ...source };
        const probe = await createCouchDBConnectionProbeFactory({} as never)(source);
        const replicator = mocks.couchDB[0];
        replicator.connectRemoteCouchDBWithSetting.mockResolvedValue("connection failed");

        expect(await probe.check()).toEqual({ ok: false, reason: "connection failed" });

        const status = { estimatedSize: 12 };
        replicator.getRemoteStatus.mockResolvedValue(status);
        source.couchDB_DBNAME = "changed-vault";
        expect(await probe.getStatus()).toBe(status);
        expect(replicator.getRemoteStatus).toHaveBeenCalledWith(snapshot);
    });

    it("emits a result Notice only for an explicitly visible successful CouchDB probe", async () => {
        const probe = await createCouchDBConnectionProbeFactory({} as never)(createSettings());
        const replicator = mocks.couchDB[0];
        replicator.connectRemoteCouchDBWithSetting.mockResolvedValue({
            info: { db_name: "vault" },
            close: vi.fn(async () => undefined),
        });

        await expect(probe.check({ showResult: true })).resolves.toEqual({ ok: true });

        expect(mocks.logger).toHaveBeenCalledTimes(1);
        expect(mocks.logger).toHaveBeenCalledWith("Connected to vault successfully", LOG_LEVEL_NOTICE);

        mocks.logger.mockClear();
        await expect(probe.check()).resolves.toEqual({ ok: true });
        expect(mocks.logger).not.toHaveBeenCalled();
    });

    it("emits a result Notice only for an explicitly visible CouchDB connection failure", async () => {
        const reason = "connection failed";
        const translatedFailure = "translated CouchDB connection failure";
        const translate = vi.fn(() => translatedFailure);
        const settings = createSettings();
        const probe = await createCouchDBConnectionProbeFactory({ services: { context: { translate } } } as never)(
            settings
        );
        const replicator = mocks.couchDB[0];
        replicator.connectRemoteCouchDBWithSetting.mockResolvedValue(reason);

        await expect(probe.check({ showResult: true })).resolves.toEqual({ ok: false, reason });

        expect(mocks.logger).toHaveBeenCalledTimes(1);
        expect(translate).toHaveBeenCalledWith("liveSyncReplicator.couldNotConnectTo", {
            uri: settings.couchDB_URI,
            name: settings.couchDB_DBNAME,
            db: reason,
        });
        expect(mocks.logger).toHaveBeenCalledWith(translatedFailure, LOG_LEVEL_NOTICE);

        mocks.logger.mockClear();
        translate.mockClear();
        await expect(probe.check()).resolves.toEqual({ ok: false, reason });
        expect(mocks.logger).not.toHaveBeenCalled();
        expect(translate).not.toHaveBeenCalled();
    });

    it("creates an unpublished Object Storage replicator for each probe and normalises connection results", async () => {
        const host = { name: "host" };
        const source = createSettings({ remoteType: REMOTE_MINIO });
        const snapshot = { ...source };
        const factory = createObjectStorageConnectionProbeFactory(host as never);
        const firstProbe = await factory(source);
        const secondProbe = await factory(source);
        expect(mocks.objectStorage).toHaveLength(2);

        const firstReplicator = mocks.objectStorage[0];
        firstReplicator.tryConnectRemote.mockResolvedValue(true);
        source.endpoint = "https://changed.example.test";
        expect(await firstProbe.check()).toEqual({ ok: true });
        expect(firstReplicator.tryConnectRemote).toHaveBeenCalledWith(snapshot, false);

        const secondReplicator = mocks.objectStorage[1];
        secondReplicator.tryConnectRemote.mockResolvedValue(false);
        expect(await secondProbe.check({ showResult: true })).toEqual({ ok: false });
        expect(secondReplicator.tryConnectRemote).toHaveBeenCalledWith(snapshot, true);

        const error = new Error("storage offline");
        secondReplicator.tryConnectRemote.mockRejectedValue(error);
        expect(await secondProbe.check()).toEqual({ ok: false, reason: error });
    });

    it("delegates Object Storage status and preferred-tweak reads to the trial snapshot", async () => {
        const source = createSettings({ remoteType: REMOTE_MINIO });
        const snapshot = { ...source };
        const connectionProbe = await createObjectStorageConnectionProbeFactory({} as never)(source);
        const preferredProbe = await createObjectStoragePreferredTweakProbeFactory({} as never)(source);
        const connectionReplicator = mocks.objectStorage[0];
        const preferredReplicator = mocks.objectStorage[1];
        const status = { estimatedSize: 42 };
        const preferred = { status: "unsupported" } as const;
        connectionReplicator.getRemoteStatus.mockResolvedValue(status);
        preferredReplicator.getRemotePreferredTweakValues.mockResolvedValue(preferred);

        source.bucket = "changed-vault";
        expect(await connectionProbe.getStatus()).toBe(status);
        expect(await preferredProbe.read()).toBe(preferred);
        expect(connectionReplicator.getRemoteStatus).toHaveBeenCalledWith(snapshot);
        expect(preferredReplicator.getRemotePreferredTweakValues).toHaveBeenCalledWith(snapshot);
    });

    it("shares one successful asynchronous disposal promise for every probe kind", async () => {
        const couchProbe = await createCouchDBPreferredTweakProbeFactory({} as never)(createSettings());
        const objectProbe = await createObjectStoragePreferredTweakProbeFactory({} as never)(
            createSettings({ remoteType: REMOTE_MINIO })
        );
        const couchReplicator = mocks.couchDB[0];
        const objectReplicator = mocks.objectStorage[0];

        const couchDisposal = couchProbe.dispose();
        expect(couchProbe.dispose()).toBe(couchDisposal);
        const objectDisposal = objectProbe.dispose();
        expect(objectProbe.dispose()).toBe(objectDisposal);
        await Promise.all([couchDisposal, objectDisposal]);
        expect(couchReplicator.closeReplication).toHaveBeenCalledOnce();
        expect(objectReplicator.closeReplication).toHaveBeenCalledOnce();
    });

    it("shares a rejected disposal promise and never retries closeReplication", async () => {
        const probe = await createObjectStorageConnectionProbeFactory({} as never)(
            createSettings({ remoteType: REMOTE_MINIO })
        );
        const replicator = mocks.objectStorage[0];
        const failure = new Error("close failed");
        replicator.closeReplication.mockImplementation(() => {
            throw failure;
        });

        const disposal = probe.dispose();
        expect(probe.dispose()).toBe(disposal);
        await expect(disposal).rejects.toBe(failure);
        expect(replicator.closeReplication).toHaveBeenCalledOnce();
    });

    it("reads the Security Seed from a settings snapshot and disposes its private Replicator", async () => {
        const couchSettings = createSettings();
        const couchSnapshot = { ...couchSettings };
        const objectSettings = createSettings({ remoteType: REMOTE_MINIO });
        const objectSnapshot = { ...objectSettings };
        const couchResource = await createCouchDBSecuritySeedResourceFactory({} as never)(couchSettings);
        const objectResource = await createObjectStorageSecuritySeedResourceFactory({} as never)(objectSettings);
        const couchReplicator = mocks.couchDB[0];
        const objectReplicator = mocks.objectStorage[0];
        const couchSeed = new Uint8Array([1]);
        const objectSeed = new Uint8Array([2]);
        couchReplicator.getReplicationPBKDF2Salt.mockResolvedValue(couchSeed);
        objectReplicator.getReplicationPBKDF2Salt.mockResolvedValue(objectSeed);

        couchSettings.couchDB_URI = "https://changed.example.test";
        objectSettings.endpoint = "https://changed.example.test";
        await expect(couchResource.read()).resolves.toBe(couchSeed);
        await expect(objectResource.read()).resolves.toBe(objectSeed);
        expect(couchReplicator.getReplicationPBKDF2Salt).toHaveBeenCalledWith(couchSnapshot, true);
        expect(objectReplicator.getReplicationPBKDF2Salt).toHaveBeenCalledWith(objectSnapshot, true);

        await Promise.all([couchResource.dispose(), objectResource.dispose()]);
        expect(couchReplicator.closeReplication).toHaveBeenCalledOnce();
        expect(objectReplicator.closeReplication).toHaveBeenCalledOnce();
    });

    it("checks synchronisation information through an owned connection and disposes the private Replicator", async () => {
        const settings = createSettings();
        const snapshot = { ...settings };
        const resource = await createCouchDBSynchronisationInformationResourceFactory({} as never)(settings);
        const replicator = mocks.couchDB[0];
        const database = { close: vi.fn() };
        const close = vi.fn(async () => undefined);
        replicator.connectRemoteCouchDBWithSetting.mockResolvedValue({ db: database, close });

        settings.couchDB_DBNAME = "changed-vault";
        await expect(resource.check()).resolves.toBe(true);
        expect(replicator.connectRemoteCouchDBWithSetting).toHaveBeenCalledWith(snapshot, false, true);
        expect(mocks.checkSyncInfo).toHaveBeenCalledWith(database);
        expect(close).toHaveBeenCalledOnce();
        expect(database.close).not.toHaveBeenCalled();

        await resource.dispose();
        expect(replicator.closeReplication).toHaveBeenCalledOnce();
    });

    it("preserves a CouchDB connection or setup failure for the settings flow to report", async () => {
        const reason = "connection failed";
        const resource = await createCouchDBSynchronisationInformationResourceFactory({} as never)(createSettings());
        const replicator = mocks.couchDB[0];
        replicator.connectRemoteCouchDBWithSetting.mockResolvedValue(reason);

        await expect(resource.check()).rejects.toMatchObject({ message: reason });
    });

    it("closes the owned connection when synchronisation-information verification rejects", async () => {
        const resource = await createCouchDBSynchronisationInformationResourceFactory({} as never)(createSettings());
        const replicator = mocks.couchDB[0];
        const database = { close: vi.fn() };
        const close = vi.fn(async () => undefined);
        const failure = new Error("verification failed");
        replicator.connectRemoteCouchDBWithSetting.mockResolvedValue({ db: database, close });
        mocks.checkSyncInfo.mockRejectedValue(failure);

        await expect(resource.check()).rejects.toBe(failure);
        expect(close).toHaveBeenCalledOnce();
        expect(database.close).not.toHaveBeenCalled();

        await resource.dispose();
        expect(replicator.closeReplication).toHaveBeenCalledOnce();
    });
});
