import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    useCouchDBReplicatorFactory,
    useMinIOReplicatorFactory,
    createCouchDBReplicatorHandler,
    resumeCouchDBReplicationHandler,
    createMinIOReplicatorHandler,
} from "./replicatorFactories";
import { createMockServiceHub } from "../mockServiceHub";
import { LiveSyncCouchDBReplicator } from "@lib/replication/couchdb/LiveSyncReplicator";
import { LiveSyncJournalReplicator } from "@lib/replication/journal/LiveSyncJournalReplicator";
import { REMOTE_MINIO, REMOTE_P2P } from "@lib/common/types";

vi.mock("@lib/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {},
}));
vi.mock("@lib/replication/journal/LiveSyncJournalReplicator", () => ({
    LiveSyncJournalReplicator: class {},
}));

describe("replicatorFactories", () => {
    let mockHub: ReturnType<typeof createMockServiceHub>;
    let settings: any;
    let replicator: any;
    let replication: any;

    beforeEach(() => {
        mockHub = createMockServiceHub();
        settings = mockHub.services.setting.settings;
        replicator = mockHub.services.replicator;
        replication = mockHub.services.replication;
    });

    describe("useCouchDBReplicatorFactory", () => {
        it("should register useCouchDBReplicatorFactory handlers", () => {
            useCouchDBReplicatorFactory(mockHub as any);
            expect((mockHub.services.replicator.getNewReplicator as any).handlers.length).toBeGreaterThan(0);
            expect((mockHub.services.appLifecycle.onResumed as any).handlers.length).toBeGreaterThan(0);
        });

        it("createCouchDBReplicatorHandler should return false for MinIO or P2P", async () => {
            settings.remoteType = REMOTE_MINIO;
            const resMinIO = await createCouchDBReplicatorHandler(mockHub as any);
            expect(resMinIO).toBe(false);

            settings.remoteType = REMOTE_P2P;
            const resP2P = await createCouchDBReplicatorHandler(mockHub as any);
            expect(resP2P).toBe(false);
        });

        it("createCouchDBReplicatorHandler should return LiveSyncCouchDBReplicator for couchdb", async () => {
            settings.remoteType = "couchdb";
            const res = await createCouchDBReplicatorHandler(mockHub as any);
            expect(res).toBeInstanceOf(LiveSyncCouchDBReplicator);
        });

        it("resumeCouchDBReplicationHandler should return true early if suspended or not ready", async () => {
            mockHub.services.appLifecycle.isSuspended.mockReturnValue(true);
            let res = await resumeCouchDBReplicationHandler(mockHub as any);
            expect(res).toBe(true);

            mockHub.services.appLifecycle.isSuspended.mockReturnValue(false);
            mockHub.services.appLifecycle.isReady.mockReturnValue(false);
            res = await resumeCouchDBReplicationHandler(mockHub as any);
            expect(res).toBe(true);
        });

        it("resumeCouchDBReplicationHandler should skip for MinIO or P2P", async () => {
            mockHub.services.appLifecycle.isSuspended.mockReturnValue(false);
            mockHub.services.appLifecycle.isReady.mockReturnValue(true);
            settings.remoteType = REMOTE_MINIO;

            replication.isReplicationReady = vi.fn();
            const res = await resumeCouchDBReplicationHandler(mockHub as any);
            expect(res).toBe(true);
            expect(replication.isReplicationReady).not.toHaveBeenCalled();
        });

        it("resumeCouchDBReplicationHandler should run replication if liveSync is enabled and ready", async () => {
            mockHub.services.appLifecycle.isSuspended.mockReturnValue(false);
            mockHub.services.appLifecycle.isReady.mockReturnValue(true);
            settings.remoteType = "couchdb";
            settings.liveSync = true;

            const mockReplicator = { openReplication: vi.fn().mockResolvedValue(true) };
            replicator.getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
            replication.isReplicationReady = vi.fn().mockResolvedValue(true);

            const res = await resumeCouchDBReplicationHandler(mockHub as any);
            expect(res).toBe(true);

            // Wait for fireAndForget microtasks to complete
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(replication.isReplicationReady).toHaveBeenCalledWith(false);
            expect(mockReplicator.openReplication).toHaveBeenCalledWith(
                mockHub.services.setting.settings,
                true,
                false,
                false
            );
        });

        it("resumeCouchDBReplicationHandler should not run replication if not ready to replicate", async () => {
            mockHub.services.appLifecycle.isSuspended.mockReturnValue(false);
            mockHub.services.appLifecycle.isReady.mockReturnValue(true);
            settings.remoteType = "couchdb";
            settings.liveSync = true;

            const mockReplicator = { openReplication: vi.fn() };
            replicator.getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
            replication.isReplicationReady = vi.fn().mockResolvedValue(false);

            const res = await resumeCouchDBReplicationHandler(mockHub as any);
            expect(res).toBe(true);

            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(replication.isReplicationReady).toHaveBeenCalledWith(false);
            expect(mockReplicator.openReplication).not.toHaveBeenCalled();
        });

        it("resumeCouchDBReplicationHandler should run one-shot replication if syncOnStart is enabled", async () => {
            mockHub.services.appLifecycle.isSuspended.mockReturnValue(false);
            mockHub.services.appLifecycle.isReady.mockReturnValue(true);
            settings.remoteType = "couchdb";
            settings.liveSync = false;
            settings.syncOnStart = true;

            const mockReplicator = { openReplication: vi.fn().mockResolvedValue(true) };
            replicator.getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
            replication.isReplicationReady = vi.fn().mockResolvedValue(true);

            const res = await resumeCouchDBReplicationHandler(mockHub as any);
            expect(res).toBe(true);

            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(mockReplicator.openReplication).toHaveBeenCalledWith(
                mockHub.services.setting.settings,
                false,
                false,
                false
            );
        });
    });

    describe("useMinIOReplicatorFactory", () => {
        it("should register useMinIOReplicatorFactory handlers", () => {
            useMinIOReplicatorFactory(mockHub as any);
            expect((mockHub.services.replicator.getNewReplicator as any).handlers.length).toBeGreaterThan(0);
        });

        it("createMinIOReplicatorHandler should return false for couchdb", async () => {
            settings.remoteType = "couchdb";
            const res = await createMinIOReplicatorHandler(mockHub as any);
            expect(res).toBe(false);
        });

        it("createMinIOReplicatorHandler should return LiveSyncJournalReplicator for MinIO", async () => {
            settings.remoteType = REMOTE_MINIO;
            const res = await createMinIOReplicatorHandler(mockHub as any);
            expect(res).toBeInstanceOf(LiveSyncJournalReplicator);
        });
    });
});
