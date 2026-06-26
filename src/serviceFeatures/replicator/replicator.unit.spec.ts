import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    useReplicator,
    onReplicatorInitialisedHandler,
    parseReplicationResultHandler,
    everyOnloadAfterLoadSettingsHandler,
    everyOnDatabaseInitializedHandler,
    everyBeforeReplicateHandler,
    cleanedHandler,
    onReplicationFailedHandler,
} from "./replicator";
import { createMockServiceHub } from "../mockServiceHub";
import type { ReplicateResultProcessor } from "./replicateResultProcessor";
import { eventHub, EVENT_FILE_SAVED, EVENT_SETTING_SAVED } from "@/common/events";
import { LiveSyncCouchDBReplicator } from "@lib/replication/couchdb/LiveSyncReplicator";
import { $msg } from "@lib/common/i18n";

vi.mock("./replicateResultProcessor", () => {
    return {
        useReplicateResultProcessor: vi.fn(() => ({
            suspend: vi.fn(),
            resume: vi.fn(),
            restoreFromSnapshotOnce: vi.fn().mockResolvedValue(true),
            enqueueAll: vi.fn(),
        })),
    };
});

vi.mock("@lib/services/base/UnresolvedErrorManager", () => {
    return {
        UnresolvedErrorManager: class {
            showError = vi.fn();
            clearError = vi.fn();
            clearErrors = vi.fn();
        },
    };
});

vi.mock("@lib/pouchdb/chunks", () => {
    return {
        purgeUnreferencedChunks: vi.fn().mockResolvedValue(5),
        balanceChunkPurgedDBs: vi.fn().mockResolvedValue(true),
    };
});

vi.mock("@lib/replication/couchdb/LiveSyncReplicator", () => {
    return {
        LiveSyncCouchDBReplicator: class {
            connectRemoteCouchDBWithSetting = vi.fn();
            openReplication = vi.fn();
            markRemoteResolved = vi.fn();
        },
    };
});

describe("useReplicator", () => {
    let mockHub: ReturnType<typeof createMockServiceHub>;

    const createMockProcessor = (): ReplicateResultProcessor => ({
        suspend: vi.fn(),
        resume: vi.fn(),
        restoreFromSnapshotOnce: vi.fn().mockResolvedValue(undefined),
        enqueueAll: vi.fn(),
    });

    beforeEach(() => {
        mockHub = createMockServiceHub();
        (mockHub.services as any).tweakValue = {
            askResolvingMismatched: vi.fn(),
            checkAndAskResolvingMismatched: { setHandler: vi.fn() },
            fetchRemotePreferred: { setHandler: vi.fn() },
            checkAndAskUseRemoteConfiguration: { setHandler: vi.fn() },
            askUseRemoteConfiguration: { setHandler: vi.fn() },
        } as any;
        (mockHub.services.database.localDatabase as any).clearCaches = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should provide replicator functionality and register handlers", () => {
        useReplicator(mockHub as any);
        expect((mockHub.services.replicator.onReplicatorInitialised as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.databaseEvents.onDatabaseInitialised as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.appLifecycle.onSettingLoaded as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.replication.parseSynchroniseResult as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.replication.onBeforeReplicate as any).handlers.length).toBeGreaterThan(0);
        expect((mockHub.services.replication.onReplicationFailed as any).handlers.length).toBeGreaterThan(0);
    });

    it("onReplicatorInitialisedHandler should return true", async () => {
        const res = await onReplicatorInitialisedHandler();
        expect(res).toBe(true);
    });

    it("parseReplicationResultHandler should enqueue docs", async () => {
        const mockProcessor = createMockProcessor();
        const res = await parseReplicationResultHandler(mockProcessor, []);
        expect(mockProcessor.enqueueAll).toHaveBeenCalledWith([]);
        expect(res).toBe(true);
    });

    it("should execute registered commands", async () => {
        useReplicator(mockHub as any);
        const addCommandMock = mockHub.services.API.addCommand as any;

        const replicateCmd = addCommandMock.mock.calls.find((c: any) => c[0].id === "livesync-replicate")[0];
        mockHub.services.replication.replicate = vi.fn();
        await replicateCmd.callback();
        expect(mockHub.services.replication.replicate).toHaveBeenCalled();

        const abortCmd = addCommandMock.mock.calls.find((c: any) => c[0].id === "livesync-abortsync")[0];
        const mockReplicator = { terminateSync: vi.fn() };
        (mockHub.services.replicator as any).getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
        await abortCmd.callback();
        expect(mockReplicator.terminateSync).toHaveBeenCalled();
    });

    it("onBeforeReplicate online checks", async () => {
        useReplicator(mockHub as any);
        const onlineCheck = (mockHub.services.replication.onBeforeReplicate as any).handlers[0];

        (mockHub.services.API as any).isOnline = false;
        const resOffline = await onlineCheck(false);
        expect(resOffline).toBe(false);

        (mockHub.services.API as any).isOnline = true;
        const resOnline = await onlineCheck(false);
        expect(resOnline).toBe(true);
    });

    it("onBeforeReplicate PBKDF2 checks", async () => {
        useReplicator(mockHub as any);
        const pbkdf2Check = (mockHub.services.replication.onBeforeReplicate as any).handlers[1];

        (mockHub.services.replicator as any).getActiveReplicator = vi.fn().mockReturnValue(null);
        let res = await pbkdf2Check(false);
        expect(res).toBe(false);

        const mockReplicator = { ensurePBKDF2Salt: vi.fn().mockResolvedValue(false) };
        (mockHub.services.replicator as any).getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
        res = await pbkdf2Check(false);
        expect(res).toBe(false);

        mockReplicator.ensurePBKDF2Salt.mockResolvedValue(true);
        res = await pbkdf2Check(false);
        expect(res).toBe(true);
    });

    it("everyOnloadAfterLoadSettingsHandler should register event listeners", async () => {
        vi.useFakeTimers();
        try {
            const mockProcessor = createMockProcessor();
            await everyOnloadAfterLoadSettingsHandler(mockHub as any, mockProcessor);

            (mockHub.services.setting.settings as any).syncOnSave = true;
            mockHub.services.appLifecycle.isSuspended.mockReturnValue(false);
            mockHub.services.replication.replicateByEvent = vi.fn();

            eventHub.emitEvent(EVENT_FILE_SAVED);
            vi.runAllTimers();
            expect(mockHub.services.replication.replicateByEvent).toHaveBeenCalled();

            (mockHub.services.setting.settings as any).suspendParseReplicationResult = true;
            eventHub.emitEvent(EVENT_SETTING_SAVED, mockHub.services.setting.settings as any);
            expect(mockProcessor.suspend).toHaveBeenCalled();

            (mockHub.services.setting.settings as any).suspendParseReplicationResult = false;
            eventHub.emitEvent(EVENT_SETTING_SAVED, mockHub.services.setting.settings as any);
            expect(mockProcessor.resume).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("everyOnDatabaseInitializedHandler and everyBeforeReplicateHandler", async () => {
        const mockProcessor = createMockProcessor();

        await everyOnDatabaseInitializedHandler(mockProcessor, false);
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(mockProcessor.restoreFromSnapshotOnce).toHaveBeenCalled();

        (mockProcessor.restoreFromSnapshotOnce as any).mockClear();

        const unresolvedErrorManager = { clearErrors: vi.fn(), showError: vi.fn(), clearError: vi.fn() };
        await everyBeforeReplicateHandler(unresolvedErrorManager as any, mockProcessor, false);
        expect(mockProcessor.restoreFromSnapshotOnce).toHaveBeenCalled();
        expect(unresolvedErrorManager.clearErrors).toHaveBeenCalled();
    });

    it("onReplicationFailedHandler tweak mismatch", async () => {
        const mockReplicator = {
            tweakSettingsMismatched: true,
            preferredTweakValue: { tweakModified: 123 },
        };
        (mockHub.services.replicator as any).getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);
        (mockHub.services as any).tweakValue.askResolvingMismatched = vi.fn().mockResolvedValue("OK");

        const res = await onReplicationFailedHandler(mockHub as any, false);
        expect((mockHub.services as any).tweakValue.askResolvingMismatched).toHaveBeenCalledWith(
            mockReplicator.preferredTweakValue
        );
        expect(res).toBe(false);
    });

    it("onReplicationFailedHandler locked and remote cleaned (cleanedHandler)", async () => {
        const mockReplicator = Object.create(LiveSyncCouchDBReplicator.prototype);
        mockReplicator.tweakSettingsMismatched = false;
        mockReplicator.remoteLockedAndDeviceNotAccepted = true;
        mockReplicator.remoteCleaned = true;
        (mockHub.services.setting.settings as any).useIndexedDBAdapter = true;

        (mockHub.services.replicator as any).getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);

        (mockHub.services as any).UI = {
            confirm: {
                confirmWithMessage: vi.fn().mockResolvedValue("Cleanup"),
                askSelectStringDialogue: vi.fn(),
            },
        } as any;

        const remoteDBMock = { db: {} };
        mockReplicator.connectRemoteCouchDBWithSetting = vi.fn().mockResolvedValue(remoteDBMock);
        mockReplicator.openReplication = vi.fn().mockResolvedValue(true);
        mockReplicator.markRemoteResolved = vi.fn().mockResolvedValue(true);

        (mockHub.services.API as any).isMobile = vi.fn().mockReturnValue(false);
        (mockHub as any).serviceModules = {
            rebuilder: {
                $performRebuildDB: vi.fn(),
            },
        };

        const res = await onReplicationFailedHandler(mockHub as any, false);
        expect(res).toBe(false);
        expect((mockHub.services as any).UI.confirm.confirmWithMessage).toHaveBeenCalled();
        expect(mockReplicator.connectRemoteCouchDBWithSetting).toHaveBeenCalled();
        expect(mockReplicator.openReplication).toHaveBeenCalled();
        expect(mockReplicator.markRemoteResolved).toHaveBeenCalled();
    });

    it("cleanedHandler option Fetch again", async () => {
        (mockHub.services as any).UI = {
            confirm: {
                confirmWithMessage: vi.fn().mockResolvedValue("Fetch again"),
            },
        } as any;
        (mockHub as any).serviceModules = {
            rebuilder: {
                $performRebuildDB: vi.fn(),
            },
        };

        await cleanedHandler(mockHub as any, false);
        expect((mockHub as any).serviceModules.rebuilder.$performRebuildDB).toHaveBeenCalledWith("localOnly");
    });

    it("onReplicationFailedHandler locked manual options", async () => {
        const mockReplicator = {
            tweakSettingsMismatched: false,
            remoteLockedAndDeviceNotAccepted: true,
            remoteCleaned: false,
            markRemoteResolved: vi.fn().mockResolvedValue(true),
        };
        (mockHub.services.replicator as any).getActiveReplicator = vi.fn().mockReturnValue(mockReplicator);

        (mockHub.services as any).UI = {
            confirm: {
                askSelectStringDialogue: vi.fn().mockResolvedValue($msg("Replicator.Dialogue.Locked.Action.Unlock")),
            },
        } as any;
        (mockHub as any).serviceModules = {
            rebuilder: {
                scheduleFetch: vi.fn(),
            },
        };
        (mockHub.services.appLifecycle as any).scheduleRestart = vi.fn();

        let res = await onReplicationFailedHandler(mockHub as any, false);
        expect(res).toBe(false);
        expect(mockReplicator.markRemoteResolved).toHaveBeenCalled();

        (mockHub.services as any).UI.confirm.askSelectStringDialogue.mockResolvedValue(
            $msg("Replicator.Dialogue.Locked.Action.Fetch")
        );
        res = await onReplicationFailedHandler(mockHub as any, false);
        expect(res).toBe(false);
        expect((mockHub as any).serviceModules.rebuilder.scheduleFetch).toHaveBeenCalled();
        expect((mockHub.services.appLifecycle as any).scheduleRestart).toHaveBeenCalled();
    });
});
