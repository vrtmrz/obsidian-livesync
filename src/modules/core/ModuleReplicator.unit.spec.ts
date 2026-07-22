import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { EVENT_SETTING_SAVED, eventHub } from "@/common/events";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";

const chunkMocks = vi.hoisted(() => ({
    purgeUnreferencedChunks: vi.fn(async (_db: unknown, countOnly: boolean) => (countOnly ? 2 : 0)),
    balanceChunkPurgedDBs: vi.fn(async () => undefined),
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/pouchdb/chunks", () => chunkMocks);
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {},
}));

import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { ModuleReplicator } from "./ModuleReplicator";

describe("ModuleReplicator", () => {
    it("refreshes the remote Security Seed before replication", async () => {
        const ensurePBKDF2Salt = vi.fn(async () => true);
        let beforeReplicate: ((showMessage: boolean) => Promise<boolean>) | undefined;
        const addHandler = vi.fn((handler: (showMessage: boolean) => Promise<boolean>, priority?: number) => {
            if (priority === 20) {
                beforeReplicate = handler;
            }
        });
        const services = {
            API: { isOnline: true },
            replicator: {
                onReplicatorInitialised: { addHandler: vi.fn() },
                getActiveReplicator: () => ({ ensurePBKDF2Salt }),
            },
            setting: { currentSettings: () => ({}) },
            databaseEvents: { onDatabaseInitialised: { addHandler: vi.fn() } },
            appLifecycle: { onSettingLoaded: { addHandler: vi.fn() } },
            replication: {
                parseSynchroniseResult: { addHandler: vi.fn() },
                onBeforeReplicate: { addHandler },
                onReplicationFailed: { addHandler: vi.fn() },
            },
        };
        const module = {
            _unresolvedErrorManager: {
                showError: vi.fn(),
                clearError: vi.fn(),
            },
            _onReplicatorInitialised: vi.fn(),
            _everyOnDatabaseInitialized: vi.fn(),
            _everyOnloadAfterLoadSettings: vi.fn(),
            _parseReplicationResult: vi.fn(),
            _everyBeforeReplicate: vi.fn(),
            onReplicationFailed: vi.fn(),
        };

        ModuleReplicator.prototype.onBindFunction.call(module, {} as never, services as never);
        expect(beforeReplicate).toBeDefined();

        await beforeReplicate!(false);

        expect(ensurePBKDF2Salt).toHaveBeenCalledWith({}, false, false);
    });

    it("reprocesses stored documents when the normal-file target filters change", async () => {
        eventHub.offAll();
        const settings = {
            handleFilenameCaseSensitive: false,
            ignoreFiles: ".gitignore",
            maxMTimeForReflectEvents: 0,
            syncOnlyRegEx: "^E2E/allowed/.*",
            syncIgnoreRegEx: "",
            syncInternalFiles: false,
            syncMaxSizeInMB: 0,
            suspendParseReplicationResult: false,
            useIgnoreFiles: false,
        } as ObsidianLiveSyncSettings;
        const services = {
            context: createServiceContext(),
            API: {
                addLog: vi.fn(),
                addCommand: vi.fn(),
                registerWindow: vi.fn(),
                addRibbonIcon: vi.fn(),
                registerProtocolHandler: vi.fn(),
            },
            appLifecycle: {
                getUnresolvedMessages: { addHandler: vi.fn() },
                isSuspended: vi.fn(() => false),
            },
        };
        const core = {
            _services: services,
            services,
            settings,
        } as any;
        const module = new ModuleReplicator(core);
        const reprocessStoredDocuments = vi.fn(async () => 1);
        Object.assign(module.processor, { reprocessStoredDocuments });

        try {
            await (module as any)._everyOnloadAfterLoadSettings();
            eventHub.emitEvent(EVENT_SETTING_SAVED, { ...settings });
            await Promise.resolve();
            expect(reprocessStoredDocuments).not.toHaveBeenCalled();

            Object.assign(settings, { syncOnlyRegEx: "" });
            eventHub.emitEvent(EVENT_SETTING_SAVED, { ...settings });
            await vi.waitFor(() => expect(reprocessStoredDocuments).toHaveBeenCalledOnce());

            settings.syncMaxSizeInMB = 10;
            eventHub.emitEvent(EVENT_SETTING_SAVED, { ...settings });
            await vi.waitFor(() => expect(reprocessStoredDocuments).toHaveBeenCalledTimes(2));
        } finally {
            eventHub.offAll();
        }
    });
});

describe("ModuleReplicator legacy cleanup", () => {
    it("keeps its finite replication and balancing work inside the shared activity boundary", async () => {
        const activityFinished = vi.fn();
        const runBoundedRemoteActivity = vi.fn(async (task: () => unknown) => {
            try {
                return await task();
            } finally {
                activityFinished();
            }
        });
        const runFiniteReplicationActivity = vi.fn(async (task: () => unknown) => await task());
        const openReplication = vi.fn(async () => true);
        const activeReplicator = Object.assign(new LiveSyncCouchDBReplicator({} as any), {
            connectRemoteCouchDBWithSetting: vi.fn(async () => ({ db: {} })),
            markRemoteResolved: vi.fn(async () => undefined),
        });
        const services = {
            context: createServiceContext(),
            API: {
                addLog: vi.fn(),
                addCommand: vi.fn(),
                registerWindow: vi.fn(),
                addRibbonIcon: vi.fn(),
                registerProtocolHandler: vi.fn(),
                isMobile: vi.fn(() => false),
            },
            setting: { saveSettingData: vi.fn(async () => undefined) },
            appLifecycle: {
                getUnresolvedMessages: { addHandler: vi.fn() },
            },
            replicator: {
                getActiveReplicator: vi.fn(() => activeReplicator),
                runBoundedRemoteActivity,
                runFiniteReplicationActivity,
            },
        };
        const localDatabase = {
            localDatabase: {},
            clearCaches: vi.fn(),
        };
        const core = {
            _services: services,
            services,
            settings: {},
            localDatabase,
            confirm: { confirmWithMessage: vi.fn(async () => "Cleanup") },
            replicator: { openReplication },
        } as any;
        const module = new ModuleReplicator(core);

        await module.cleaned(true);

        expect(runBoundedRemoteActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "database-cleanup",
        });
        expect(runFiniteReplicationActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "replication",
        });
        expect(openReplication).toHaveBeenCalledOnce();
        expect(openReplication.mock.invocationCallOrder[0]).toBeLessThan(activityFinished.mock.invocationCallOrder[0]);
        expect(chunkMocks.balanceChunkPurgedDBs).toHaveBeenCalledOnce();
    });
});
