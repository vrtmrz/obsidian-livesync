import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, REMOTE_COUCHDB, REMOTE_MINIO } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    CENTRAL_REMOTE_ADMINISTRATION_ACTIONS,
    CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS,
    CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS,
    CENTRAL_REMOTE_ADMINISTRATION_RESULT_STATUSES,
} from "@vrtmrz/livesync-commonlib/replication";
import {
    COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY,
    OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY,
} from "./centralRemoteAdministration";

describe("central remote administration capabilities", () => {
    it("mutates CouchDB, verifies the requested postcondition, and closes only the owned connection", async () => {
        const rawDatabaseClose = vi.fn(async () => undefined);
        const close = vi.fn(async () => undefined);
        const database = {
            get: vi.fn(async () => ({ locked: true, accepted_nodes: ["node-1"] })),
            close: rawDatabaseClose,
        };
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            isMobile: vi.fn(() => false),
            markRemoteLocked: vi.fn(async () => undefined),
            markRemoteResolved: vi.fn(async () => undefined),
            connectRemoteCouchDBWithSetting: vi.fn(async () => ({ db: database, close })),
        };
        const setting = { ...DEFAULT_SETTINGS, remoteType: REMOTE_COUCHDB };
        const capability = COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY;

        await expect(
            capability.run(replicator as never, setting, { action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.LOCK })
        ).resolves.toEqual({
            status: CENTRAL_REMOTE_ADMINISTRATION_RESULT_STATUSES.VERIFIED,
            observation: {
                kind: CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE,
                locked: true,
                accepted: true,
                nodeId: "node-1",
            },
        });

        expect(replicator.markRemoteLocked).toHaveBeenCalledWith(setting, true, false);
        expect(close).toHaveBeenCalledOnce();
        expect(rawDatabaseClose).not.toHaveBeenCalled();
    });

    it("returns a typed CouchDB failure when the observed milestone does not satisfy the action", async () => {
        const close = vi.fn(async () => undefined);
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            isMobile: vi.fn(() => false),
            markRemoteLocked: vi.fn(async () => undefined),
            markRemoteResolved: vi.fn(async () => undefined),
            connectRemoteCouchDBWithSetting: vi.fn(async () => ({
                db: { get: vi.fn(async () => ({ locked: false, accepted_nodes: ["node-1"] })) },
                close,
            })),
        };
        const capability = COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY;

        const result = await capability.run(
            replicator as never,
            { ...DEFAULT_SETTINGS, remoteType: REMOTE_COUCHDB },
            {
                action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.LOCK,
            }
        );

        expect(result).toMatchObject({
            status: CENTRAL_REMOTE_ADMINISTRATION_RESULT_STATUSES.VERIFICATION_FAILED,
            reason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.POSTCONDITION_MISMATCH,
            observation: { kind: CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE, locked: false },
        });
        expect(close).toHaveBeenCalledOnce();
    });

    it("does not mutate when initialisation succeeds without publishing a local node identity", async () => {
        const replicator = {
            nodeid: "",
            initializeDatabaseForReplication: vi.fn(async () => true),
            isMobile: vi.fn(() => false),
            markRemoteLocked: vi.fn(async () => undefined),
            markRemoteResolved: vi.fn(async () => undefined),
            connectRemoteCouchDBWithSetting: vi.fn(async () => "must not connect"),
        };
        const capability = COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY;

        await expect(
            capability.run(
                replicator as never,
                { ...DEFAULT_SETTINGS, remoteType: REMOTE_COUCHDB },
                { action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.MARK_RESOLVED }
            )
        ).resolves.toEqual({
            status: CENTRAL_REMOTE_ADMINISTRATION_RESULT_STATUSES.VERIFICATION_FAILED,
            reason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.LOCAL_IDENTITY_UNAVAILABLE,
        });
        expect(replicator.markRemoteResolved).not.toHaveBeenCalled();
        expect(replicator.connectRemoteCouchDBWithSetting).not.toHaveBeenCalled();
    });

    it("allows a CouchDB mutation exception to reject before verification", async () => {
        const failure = new Error("write failed");
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            isMobile: vi.fn(() => false),
            markRemoteLocked: vi.fn(async () => {
                throw failure;
            }),
            markRemoteResolved: vi.fn(async () => undefined),
            connectRemoteCouchDBWithSetting: vi.fn(),
        };
        const capability = COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY;

        await expect(
            capability.run(
                replicator as never,
                { ...DEFAULT_SETTINGS, remoteType: REMOTE_COUCHDB },
                {
                    action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.UNLOCK,
                }
            )
        ).rejects.toBe(failure);
        expect(replicator.connectRemoteCouchDBWithSetting).not.toHaveBeenCalled();
    });

    it("mutates Object Storage and verifies its milestone postcondition", async () => {
        const milestone = { locked: false, accepted_nodes: ["node-1"] };
        const downloadJson = vi.fn(async () => milestone);
        const downloadJsonWithResult = vi.fn(async () => ({
            status: "available" as const,
            value: milestone,
        }));
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            markRemoteLocked: vi.fn(async () => undefined),
            markRemoteResolved: vi.fn(async () => undefined),
            client: { downloadJson, downloadJsonWithResult },
        };
        const setting = { ...DEFAULT_SETTINGS, remoteType: REMOTE_MINIO };
        const capability = OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY;

        await expect(
            capability.run(replicator as never, setting, {
                action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.MARK_RESOLVED,
            })
        ).resolves.toEqual({
            status: CENTRAL_REMOTE_ADMINISTRATION_RESULT_STATUSES.VERIFIED,
            observation: {
                kind: CENTRAL_REMOTE_ADMINISTRATION_OBSERVATION_KINDS.MILESTONE,
                locked: false,
                accepted: true,
                nodeId: "node-1",
            },
        });
        expect(replicator.markRemoteResolved).toHaveBeenCalledWith(setting);
        expect(downloadJsonWithResult).toHaveBeenCalledWith("_00000000-milestone.json");
        expect(downloadJson).not.toHaveBeenCalled();
    });

    it("keeps a missing Object Storage milestone as an unverified postcondition", async () => {
        const downloadJson = vi.fn(async () => false);
        const downloadJsonWithResult = vi.fn(async () => ({ status: "not-found" as const }));
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            markRemoteLocked: vi.fn(async () => undefined),
            markRemoteResolved: vi.fn(async () => undefined),
            client: { downloadJson, downloadJsonWithResult },
        };

        const result = await OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY.run(
            replicator as never,
            { ...DEFAULT_SETTINGS, remoteType: REMOTE_MINIO },
            { action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.MARK_RESOLVED }
        );

        expect(result).toEqual({
            status: CENTRAL_REMOTE_ADMINISTRATION_RESULT_STATUSES.VERIFICATION_FAILED,
            reason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_NOT_FOUND,
        });
        expect(downloadJsonWithResult).toHaveBeenCalledWith("_00000000-milestone.json");
        expect(downloadJson).not.toHaveBeenCalled();
    });

    it("returns a typed failure with diagnostic detail when Object Storage milestone reading is unavailable", async () => {
        const diagnostic = new Error("object storage unavailable");
        const downloadJson = vi.fn(async () => false);
        const downloadJsonWithResult = vi.fn(async () => ({
            status: "unavailable" as const,
            error: diagnostic,
        }));
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            markRemoteLocked: vi.fn(async () => undefined),
            markRemoteResolved: vi.fn(async () => undefined),
            client: { downloadJson, downloadJsonWithResult },
        };

        const result = await OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY.run(
            replicator as never,
            { ...DEFAULT_SETTINGS, remoteType: REMOTE_MINIO },
            { action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.MARK_RESOLVED }
        );

        expect(result).toEqual({
            status: CENTRAL_REMOTE_ADMINISTRATION_RESULT_STATUSES.VERIFICATION_FAILED,
            reason: CENTRAL_REMOTE_ADMINISTRATION_FAILURE_REASONS.MILESTONE_READ_FAILED,
            detail: diagnostic,
        });
        expect(downloadJsonWithResult).toHaveBeenCalledWith("_00000000-milestone.json");
        expect(downloadJson).not.toHaveBeenCalled();
    });

    it("rejects an incomplete CouchDB milestone adapter before mutation", async () => {
        const markRemoteLocked = vi.fn(async () => undefined);
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            markRemoteLocked,
            markRemoteResolved: vi.fn(async () => undefined),
        };

        await expect(
            COUCHDB_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY.run(
                replicator as never,
                { ...DEFAULT_SETTINGS, remoteType: REMOTE_COUCHDB },
                { action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.LOCK }
            )
        ).rejects.toThrow("The configured CouchDB administration adapter does not provide milestone access.");
        expect(markRemoteLocked).not.toHaveBeenCalled();
    });

    it("rejects an Object Storage adapter which only exposes lossy milestone reading", async () => {
        const markRemoteResolved = vi.fn(async () => undefined);
        const replicator = {
            nodeid: "node-1",
            initializeDatabaseForReplication: vi.fn(async () => true),
            markRemoteLocked: vi.fn(async () => undefined),
            markRemoteResolved,
            client: { downloadJson: vi.fn(async () => false) },
        };

        await expect(
            OBJECT_STORAGE_CENTRAL_REMOTE_ADMINISTRATION_CAPABILITY.run(
                replicator as never,
                { ...DEFAULT_SETTINGS, remoteType: REMOTE_MINIO },
                { action: CENTRAL_REMOTE_ADMINISTRATION_ACTIONS.MARK_RESOLVED }
            )
        ).rejects.toThrow("The configured Object Storage administration adapter does not provide milestone access.");
        expect(markRemoteResolved).not.toHaveBeenCalled();
    });
});
