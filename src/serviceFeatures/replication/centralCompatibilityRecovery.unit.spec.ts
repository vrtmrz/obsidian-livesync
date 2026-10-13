import { describe, expect, it, vi } from "vitest";
import { VERSIONING_DOCID, type ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import { assessTweakCompatibility } from "@vrtmrz/livesync-commonlib/settings";
import { defaultLogger, LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, setGlobalLogFunction } from "octagonal-wheels/common/logger";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    NO_INTERACTION,
    REPLICATION_PROGRESS_PRESENTATIONS,
    USER_INITIATED_REPLICATION_AUTHORITY,
    replicationFailed,
} from "@vrtmrz/livesync-commonlib/replication";

const chunkMocks = vi.hoisted(() => ({
    purgeUnreferencedChunks: vi.fn(async (_database: unknown, countOnly: boolean) => (countOnly ? 2 : 0)),
    balanceChunkPurgedDBs: vi.fn(async () => undefined),
}));

vi.mock("@vrtmrz/livesync-commonlib/compat/pouchdb/chunks", () => chunkMocks);
vi.mock("@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator", () => ({
    LiveSyncCouchDBReplicator: class {},
}));

import { LiveSyncCouchDBReplicator } from "@vrtmrz/livesync-commonlib/compat/replication/couchdb/LiveSyncReplicator";
import { createCentralCompatibilityRecovery } from "./centralCompatibilityRecovery";

describe("central compatibility recovery", () => {
    it("does not count chunks for cleanup when local feature requirements are unknown", async () => {
        chunkMocks.purgeUnreferencedChunks.mockClear();
        const confirmWithMessage = vi.fn(async () => "Dismiss");
        const recovery = createCentralCompatibilityRecovery({
            confirm: { confirmWithMessage },
            getLocalDatabase: () => ({
                localDatabase: {
                    get: vi.fn(async (id: string) => ({
                        _id: id,
                        type: "versioninfo",
                        version: 13,
                        used_features: ["future-format-v7"],
                    })),
                },
            }),
            services: { replicator: {} },
        } as never);

        await recovery.reconcileCleanedRemote(true, {} as ObsidianLiveSyncSettings, {} as never);

        expect(chunkMocks.purgeUnreferencedChunks).not.toHaveBeenCalled();
        expect(confirmWithMessage).not.toHaveBeenCalled();
    });

    it("allows cleanup counting for a legacy local version document", async () => {
        chunkMocks.purgeUnreferencedChunks.mockClear();
        const confirmWithMessage = vi.fn(async () => "Dismiss");
        const recovery = createCentralCompatibilityRecovery({
            confirm: { confirmWithMessage },
            getLocalDatabase: () => ({
                localDatabase: {
                    get: vi.fn(async (id: string) => ({ _id: id, type: "versioninfo", version: 11 })),
                },
            }),
            services: { replicator: {} },
        } as never);

        await recovery.reconcileCleanedRemote(true, {} as ObsidianLiveSyncSettings, {} as never);

        expect(chunkMocks.purgeUnreferencedChunks).toHaveBeenCalledWith(expect.anything(), true);
        expect(confirmWithMessage).toHaveBeenCalledOnce();
    });

    it("passes the failed attempt's exact tweak assessment to mismatch resolution", async () => {
        const setting = { customChunkSize: 0 };
        const preferredTweakValue = { customChunkSize: 60 };
        const tweakAssessment = assessTweakCompatibility(setting, preferredTweakValue);
        const failedContext = { provider: {}, replicator: {} };
        const askResolvingMismatched = vi.fn(async (..._args: unknown[]) => "CHECKAGAIN");
        const recovery = createCentralCompatibilityRecovery({
            services: {
                setting: { currentSettings: () => setting },
                replicator: {
                    runWithActiveReplicatorContext: async (task: (context: unknown) => unknown) => task(failedContext),
                },
                tweakValue: { askResolvingMismatched },
            },
        } as never);

        const result = await recovery.handleReplicationFailure({
            context: failedContext,
            setting,
            outcome: replicationFailed(new Error("mismatched"), {
                reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
                preferredTweakValue,
                tweakAssessment,
            }),
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        } as never);

        expect(askResolvingMismatched.mock.calls[0][2]).toBe(tweakAssessment);
        expect(result).toBe(false);
    });

    it.each(["settings", "publication"])(
        "discards a mismatch after its %s changed before recovery",
        async (changed) => {
            const setting = { customChunkSize: 0, couchDB_DBNAME: "original" };
            const failedContext = { provider: {}, replicator: {} };
            const currentContext = changed === "publication" ? { provider: {}, replicator: {} } : failedContext;
            const currentSetting = changed === "settings" ? { ...setting, couchDB_DBNAME: "replacement" } : setting;
            const askResolvingMismatched = vi.fn(async () => "CHECKAGAIN");
            const recovery = createCentralCompatibilityRecovery({
                services: {
                    setting: { currentSettings: () => currentSetting },
                    replicator: {
                        runWithActiveReplicatorContext: async (task: (context: unknown) => unknown) =>
                            task(currentContext),
                    },
                    tweakValue: { askResolvingMismatched },
                },
            } as never);

            await recovery.handleReplicationFailure({
                context: failedContext,
                setting,
                outcome: replicationFailed(new Error("mismatched"), {
                    reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
                    preferredTweakValue: { customChunkSize: 60 },
                }),
                progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
                interaction: USER_INITIATED_REPLICATION_AUTHORITY,
            } as never);

            expect(askResolvingMismatched).not.toHaveBeenCalled();
        }
    );

    it("characterises unattended central failure handling as one INFO log without a NOTICE", async () => {
        const log = vi.fn((_message: unknown, _level?: number, _key?: string) => undefined);
        setGlobalLogFunction(log);
        try {
            const recovery = createCentralCompatibilityRecovery({
                confirm: {},
                getLocalDatabase: () => ({}),
                rebuilder: {},
                services: {
                    appLifecycle: {},
                    API: {},
                    replicator: {},
                    tweakValue: {},
                },
            } as never);

            await expect(
                recovery.handleReplicationFailure({
                    context: { provider: {}, replicator: {} },
                    setting: {},
                    outcome: replicationFailed(new Error("provider failed")),
                    progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
                    interaction: NO_INTERACTION,
                } as never)
            ).resolves.toBe(false);

            expect(log).toHaveBeenCalledOnce();
            expect(log).toHaveBeenCalledWith("Replication failed on an unattended path.", LOG_LEVEL_INFO, undefined);
            expect(log.mock.calls.map(([, level]) => level)).not.toContain(LOG_LEVEL_NOTICE);
        } finally {
            setGlobalLogFunction(defaultLogger);
        }
    });

    it("uses the exact failed outcome and permits dialogue only with recovery authority", async () => {
        const askResolvingMismatched = vi.fn(async (..._arguments: unknown[]) => undefined);
        const failedSetPreferred = vi.fn(async (_setting: unknown) => undefined);
        const failedReplicator = { setPreferredRemoteTweakSettings: failedSetPreferred };
        const replacementSetPreferred = vi.fn(async (_setting: unknown) => undefined);
        const replacementReplicator = {
            tweakSettingsMismatched: true,
            preferredTweakValue: { customChunkSize: 99 },
            setPreferredRemoteTweakSettings: replacementSetPreferred,
        };
        const failedContext = { provider: {}, replicator: failedReplicator };
        const replacementContext = { provider: {}, replicator: replacementReplicator };
        let activeContext = failedContext;
        const preferredTweakValue = { customChunkSize: 60 };
        const outcome = replicationFailed(new Error("mismatched"), {
            reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
            preferredTweakValue,
        });
        const recovery = createCentralCompatibilityRecovery({
            confirm: {},
            getLocalDatabase: () => ({}),
            rebuilder: {},
            services: {
                appLifecycle: {},
                API: {},
                setting: { currentSettings: () => ({}) },
                replicator: {
                    runWithActiveReplicatorContext: vi.fn(async (task: (context: unknown) => unknown) =>
                        task(activeContext)
                    ),
                },
                tweakValue: { askResolvingMismatched },
            },
        } as never);

        await recovery.handleReplicationFailure({
            context: failedContext,
            setting: {},
            outcome,
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
            interaction: NO_INTERACTION,
        } as never);
        expect(askResolvingMismatched).not.toHaveBeenCalled();

        await recovery.handleReplicationFailure({
            context: failedContext,
            setting: {},
            outcome,
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
            interaction: {
                kind: "permitted",
                permissions: { ...USER_INITIATED_REPLICATION_AUTHORITY.permissions, failureRecovery: false },
            },
        } as never);
        expect(askResolvingMismatched).not.toHaveBeenCalled();

        await recovery.handleReplicationFailure({
            context: failedContext,
            setting: {},
            outcome,
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.QUIET,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        } as never);
        expect(askResolvingMismatched).toHaveBeenCalledWith(
            preferredTweakValue,
            expect.any(Function),
            assessTweakCompatibility({}, preferredTweakValue)
        );
        const updatePreferredRemote = askResolvingMismatched.mock.calls[0][1] as (
            setting: Record<string, unknown>
        ) => Promise<boolean>;
        activeContext = replacementContext;
        await expect(updatePreferredRemote({ customChunkSize: 64 })).resolves.toBe(false);
        expect(failedSetPreferred).not.toHaveBeenCalled();
        expect(replacementSetPreferred).not.toHaveBeenCalled();
    });

    it("writes a mismatch decision only through the still-active failed publication", async () => {
        const setPreferredRemoteTweakSettings = vi.fn(async (_setting: unknown) => undefined);
        const failedContext = { provider: {}, replicator: { setPreferredRemoteTweakSettings } };
        let updatePreferredRemote: ((setting: Record<string, unknown>) => Promise<boolean>) | undefined;
        const askResolvingMismatched = vi.fn(
            async (_preferred: unknown, update: (setting: Record<string, unknown>) => Promise<boolean>) => {
                updatePreferredRemote = update;
            }
        );
        const recovery = createCentralCompatibilityRecovery({
            confirm: {},
            getLocalDatabase: () => ({}),
            rebuilder: {},
            services: {
                appLifecycle: {},
                API: {},
                setting: { currentSettings: () => ({}) },
                replicator: {
                    runWithActiveReplicatorContext: vi.fn(async (task: (context: unknown) => unknown) =>
                        task(failedContext)
                    ),
                },
                tweakValue: { askResolvingMismatched },
            },
        } as never);

        await recovery.handleReplicationFailure({
            context: failedContext,
            setting: {},
            outcome: replicationFailed(new Error("mismatched"), {
                reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
                preferredTweakValue: { customChunkSize: 60 },
            }),
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        } as never);

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
        const recovery = createCentralCompatibilityRecovery({
            confirm: {
                askSelectStringDialogue: vi.fn(async (_message: string, choices: string[]) => choices[1]),
            },
            getLocalDatabase: () => ({}),
            rebuilder: {},
            services: {
                appLifecycle: { scheduleRestart: vi.fn() },
                API: {},
                replicator: { runWithActiveReplicatorContext },
                tweakValue: {},
            },
        } as never);

        await recovery.handleReplicationFailure({
            context: failedContext,
            setting: {},
            outcome: replicationFailed(new Error("locked"), {
                reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_LOCKED,
            }),
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        } as never);

        expect(runWithActiveReplicatorContext).toHaveBeenCalledOnce();
        expect(failedMarkResolved).not.toHaveBeenCalled();
        expect(replacementMarkResolved).not.toHaveBeenCalled();
    });

    it("keeps cleaned-remote replication and balancing inside the shared activity boundary", async () => {
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
        const activeReplicator = Object.assign(new LiveSyncCouchDBReplicator({} as never), {
            connectRemoteCouchDBWithSetting: vi.fn(async () => ({ db: remoteDatabase, close })),
            openOneShotReplication,
            markRemoteResolved: vi.fn(async () => undefined),
        });
        const expectedContext = { provider: {}, replicator: activeReplicator };
        const runWithActiveReplicatorContext = vi.fn(async (task: (context: unknown) => unknown) =>
            task(expectedContext)
        );
        const localDatabase = {
            localDatabase: {
                get: vi.fn(async () => ({ _id: VERSIONING_DOCID, type: "versioninfo", version: 12 })),
            },
            clearCaches: vi.fn(),
        };
        const getLocalDatabase = vi.fn(() => localDatabase);
        const recovery = createCentralCompatibilityRecovery({
            confirm: { confirmWithMessage: vi.fn(async () => "Cleanup") },
            getLocalDatabase,
            rebuilder: {},
            services: {
                appLifecycle: {},
                API: { isMobile: vi.fn(() => false) },
                replicator: {
                    runBoundedRemoteActivity,
                    runFiniteReplicationActivity,
                    runWithActiveReplicatorContext,
                },
                tweakValue: {},
            },
        } as never);

        await recovery.reconcileCleanedRemote(true, {} as ObsidianLiveSyncSettings, expectedContext as never);

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
        expect(getLocalDatabase).toHaveBeenCalled();
        expect(close).toHaveBeenCalledOnce();
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(activityFinished.mock.invocationCallOrder[0]);
    });
});
