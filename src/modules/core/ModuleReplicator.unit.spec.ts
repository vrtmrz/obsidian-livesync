import { describe, expect, it, vi } from "vitest";
import { createServiceContext } from "@vrtmrz/livesync-commonlib/context";
import { EVENT_SETTING_SAVED, eventHub } from "@/common/events";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    NO_INTERACTION,
    USER_INITIATED_REPLICATION_AUTHORITY,
    replicationFailed,
} from "@vrtmrz/livesync-commonlib/replication";

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
        const read = vi.fn(async () => new Uint8Array([1]));
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ read, dispose }));
        let prepareCentralRemoteReplication: ((showMessage: boolean) => Promise<boolean>) | undefined;
        const services = {
            API: { isOnline: true },
            replicator: {
                onBeforeReplicatorPublication: { addHandler: vi.fn() },
                createRemoteResource,
            },
            setting: { currentSettings: () => ({}) },
            databaseEvents: { onDatabaseInitialised: { addHandler: vi.fn() } },
            appLifecycle: { onSettingLoaded: { addHandler: vi.fn() } },
            replication: {
                parseSynchroniseResult: { addHandler: vi.fn() },
                onBeforeReplicate: { addHandler: vi.fn() },
                onPrepareCentralRemoteReplication: {
                    addHandler: vi.fn((handler: (showMessage: boolean) => Promise<boolean>) => {
                        prepareCentralRemoteReplication = handler;
                    }),
                },
                onReplicationFailed: { addHandler: vi.fn() },
            },
        };
        const module = {
            _unresolvedErrorManager: {
                showError: vi.fn(),
                clearError: vi.fn(),
            },
            _onBeforeReplicatorPublication: vi.fn(),
            _everyOnDatabaseInitialized: vi.fn(),
            _everyOnloadAfterLoadSettings: vi.fn(),
            _parseReplicationResult: vi.fn(),
            _everyBeforeReplicate: vi.fn(),
            onReplicationFailed: vi.fn(),
        };

        ModuleReplicator.prototype.onBindFunction.call(module, {} as never, services as never);
        expect(prepareCentralRemoteReplication).toBeDefined();

        await prepareCentralRemoteReplication!(false);

        expect(createRemoteResource).toHaveBeenCalledWith("security-seed", {});
        expect(read).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("keeps online and general pre-replication handlers for P2P while skipping central-remote Security Seed preparation", async () => {
        const read = vi.fn(async () => new Uint8Array([1]));
        const dispose = vi.fn(async () => undefined);
        const createRemoteResource = vi.fn(async () => ({ read, dispose }));
        const handlers = new Map<number, (...args: unknown[]) => Promise<boolean | void>>();
        const centralRemoteHandlers: Array<(...args: unknown[]) => Promise<boolean | void>> = [];
        const addHandler = vi.fn((handler: (...args: unknown[]) => Promise<boolean | void>, priority?: number) => {
            handlers.set(priority ?? 0, handler);
        });
        const services = {
            API: { isOnline: true },
            replicator: {
                onBeforeReplicatorPublication: { addHandler: vi.fn() },
                createRemoteResource,
            },
            setting: { currentSettings: () => ({}) },
            databaseEvents: { onDatabaseInitialised: { addHandler: vi.fn() } },
            appLifecycle: { onSettingLoaded: { addHandler: vi.fn() } },
            replication: {
                parseSynchroniseResult: { addHandler: vi.fn() },
                onBeforeReplicate: { addHandler },
                onPrepareCentralRemoteReplication: {
                    addHandler: vi.fn((handler: (...args: unknown[]) => Promise<boolean | void>) => {
                        centralRemoteHandlers.push(handler);
                    }),
                },
                onReplicationFailed: { addHandler: vi.fn() },
            },
        };
        const generalBeforeReplicate = vi.fn(async () => true);
        const module = {
            _unresolvedErrorManager: {
                showError: vi.fn(),
                clearError: vi.fn(),
            },
            _onBeforeReplicatorPublication: vi.fn(),
            _everyOnDatabaseInitialized: vi.fn(),
            _everyOnloadAfterLoadSettings: vi.fn(),
            _parseReplicationResult: vi.fn(),
            _everyBeforeReplicate: generalBeforeReplicate,
            onReplicationFailed: vi.fn(),
        };

        ModuleReplicator.prototype.onBindFunction.call(module, {} as never, services as never);
        const online = handlers.get(10);
        const securitySeed = centralRemoteHandlers[0];
        const general = handlers.get(100);
        expect(online).toBeDefined();
        expect(securitySeed).toBeDefined();
        expect(general).toBeDefined();

        await expect(online!(false)).resolves.toBe(true);
        await expect(general!(false)).resolves.toBe(true);

        expect(generalBeforeReplicate).toHaveBeenCalledOnce();
        expect(createRemoteResource).not.toHaveBeenCalled();

        await expect(securitySeed!(false)).resolves.toBe(true);
        expect(createRemoteResource).toHaveBeenCalledOnce();
        expect(read).toHaveBeenCalledOnce();
        expect(dispose).toHaveBeenCalledOnce();
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

    it("uses the exact failed outcome and permits dialogue only with recovery authority", async () => {
        const askResolvingMismatched = vi.fn(async (..._args: unknown[]) => undefined);
        const failedSetPreferred = vi.fn(async (_setting: unknown) => undefined);
        const failedReplicator = { setPreferredRemoteTweakSettings: failedSetPreferred };
        const replacementSetPreferred = vi.fn(async (_setting: unknown) => undefined);
        const replacementReplicator = {
            tweakSettingsMismatched: true,
            preferredTweakValue: { customChunkSize: 99 },
            setPreferredRemoteTweakSettings: replacementSetPreferred,
        };
        const context = { provider: {}, replicator: failedReplicator };
        const replacementContext = { provider: {}, replicator: replacementReplicator };
        const preferredTweakValue = { customChunkSize: 60 };
        const outcome = replicationFailed(new Error("mismatched"), {
            reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
            preferredTweakValue,
        });
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
            },
            replicator: {
                getActiveReplicator: vi.fn(() => replacementReplicator),
                runWithActiveReplicatorContext: vi.fn(async (task: (context: unknown) => unknown) =>
                    task(replacementContext)
                ),
            },
            tweakValue: { askResolvingMismatched },
        };
        const core = {
            _services: services,
            services,
            settings: {},
        } as any;
        const module = new ModuleReplicator(core);

        await (module as any).onReplicationFailed({
            context,
            setting: {},
            outcome,
            showMessage: false,
            interaction: NO_INTERACTION,
        });
        expect(askResolvingMismatched).not.toHaveBeenCalled();

        await (module as any).onReplicationFailed({
            context,
            setting: {},
            outcome,
            showMessage: false,
            interaction: {
                kind: "permitted",
                permissions: { ...USER_INITIATED_REPLICATION_AUTHORITY.permissions, failureRecovery: false },
            },
        });
        expect(askResolvingMismatched).not.toHaveBeenCalled();

        await (module as any).onReplicationFailed({
            context,
            setting: {},
            outcome,
            showMessage: true,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });
        expect(askResolvingMismatched).toHaveBeenCalledWith(preferredTweakValue, expect.any(Function));
        const updatePreferredRemote = askResolvingMismatched.mock.calls[0][1] as (
            setting: Record<string, unknown>
        ) => Promise<boolean>;
        await expect(updatePreferredRemote({ customChunkSize: 64 } as any)).resolves.toBe(false);
        expect(failedSetPreferred).not.toHaveBeenCalled();
        expect(replacementSetPreferred).not.toHaveBeenCalled();
    });

    it("writes a mismatch decision only through the still-active failed publication", async () => {
        const setPreferredRemoteTweakSettings = vi.fn(async (_setting: unknown) => undefined);
        const context = { provider: {}, replicator: { setPreferredRemoteTweakSettings } };
        let updatePreferredRemote:
            | ((setting: Record<string, unknown>) => Promise<boolean>)
            | undefined;
        const askResolvingMismatched = vi.fn(
            async (_preferred: unknown, update: (setting: Record<string, unknown>) => Promise<boolean>) => {
                updatePreferredRemote = update;
            }
        );
        const services = {
            context: createServiceContext(),
            API: {
                addLog: vi.fn(),
                addCommand: vi.fn(),
                registerWindow: vi.fn(),
                addRibbonIcon: vi.fn(),
                registerProtocolHandler: vi.fn(),
            },
            appLifecycle: { getUnresolvedMessages: { addHandler: vi.fn() } },
            replicator: {
                runWithActiveReplicatorContext: vi.fn(async (task: (activeContext: unknown) => unknown) =>
                    task(context)
                ),
            },
            tweakValue: { askResolvingMismatched },
        };
        const module = new ModuleReplicator({ _services: services, services, settings: {} } as any);

        await (module as any).onReplicationFailed({
            context,
            setting: {},
            outcome: replicationFailed(new Error("mismatched"), {
                reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
                preferredTweakValue: { customChunkSize: 60 },
            }),
            showMessage: true,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });

        const effectiveSetting = { customChunkSize: 64 };
        await expect(updatePreferredRemote?.(effectiveSetting)).resolves.toBe(true);
        expect(setPreferredRemoteTweakSettings).toHaveBeenCalledWith(effectiveSetting);
        expect(setPreferredRemoteTweakSettings.mock.calls[0][0]).not.toBe(effectiveSetting);
    });

    it("does not apply an unlock selected for a replaced failed publication", async () => {
        const failedMarkResolved = vi.fn(async () => undefined);
        const replacementMarkResolved = vi.fn(async () => undefined);
        const failedContext = { provider: {}, replicator: { markRemoteResolved: failedMarkResolved } };
        const replacementContext = { provider: {}, replicator: { markRemoteResolved: replacementMarkResolved } };
        const runWithActiveReplicatorContext = vi.fn(async (task: (context: unknown) => unknown) =>
            task(replacementContext)
        );
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
                scheduleRestart: vi.fn(),
            },
            replicator: { runWithActiveReplicatorContext },
        };
        const core = {
            _services: services,
            services,
            settings: {},
            confirm: {
                askSelectStringDialogue: vi.fn(async (_message: string, choices: string[]) => choices[1]),
            },
            rebuilder: { scheduleFetch: vi.fn() },
        } as any;
        const module = new ModuleReplicator(core);

        await (module as any).onReplicationFailed({
            context: failedContext,
            setting: {},
            outcome: replicationFailed(new Error("locked"), {
                reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_LOCKED,
            }),
            showMessage: true,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        });

        expect(runWithActiveReplicatorContext).toHaveBeenCalledOnce();
        expect(failedMarkResolved).not.toHaveBeenCalled();
        expect(replacementMarkResolved).not.toHaveBeenCalled();
    });
});

describe("compatibility: cleaned-remote reconciliation for IndexedDB clients", () => {
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
        const openOneShotReplication = vi.fn(async () => true);
        const remoteDatabase = {
            close: vi.fn(async () => undefined),
        };
        const close = vi.fn(async () => undefined);
        const activeReplicator = Object.assign(new LiveSyncCouchDBReplicator({} as any), {
            connectRemoteCouchDBWithSetting: vi.fn(async () => ({ db: remoteDatabase, close })),
            openOneShotReplication,
            markRemoteResolved: vi.fn(async () => undefined),
        });
        const expectedContext = { provider: {}, replicator: activeReplicator };
        const runWithActiveReplicatorContext = vi.fn(async (task: (context: unknown) => unknown) =>
            task(expectedContext)
        );
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
                runWithActiveReplicatorContext,
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
        } as any;
        const module = new ModuleReplicator(core);

        await module.cleaned(true, {} as ObsidianLiveSyncSettings, expectedContext as never);

        expect(runBoundedRemoteActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "database-cleanup",
        });
        expect(runFiniteReplicationActivity).toHaveBeenCalledWith(expect.any(Function), {
            label: "replication",
        });
        expect(runWithActiveReplicatorContext).toHaveBeenCalledOnce();
        expect(openOneShotReplication).toHaveBeenCalledOnce();
        expect(openOneShotReplication.mock.invocationCallOrder[0]).toBeLessThan(
            activityFinished.mock.invocationCallOrder[0]
        );
        expect(chunkMocks.balanceChunkPurgedDBs).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(activityFinished.mock.invocationCallOrder[0]);
    });
});
