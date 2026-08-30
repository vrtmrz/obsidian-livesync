import { describe, expect, it, vi } from "vitest";
import type { ObsidianLiveSyncSettings } from "@vrtmrz/livesync-commonlib/compat/common/types";
import {
    CENTRAL_COMPATIBILITY_REJECTION_REASONS,
    NO_INTERACTION,
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
        const preferredTweakValue = { customChunkSize: 60 };
        const outcome = replicationFailed(new Error("mismatched"), {
            reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.TWEAK_MISMATCH,
            preferredTweakValue,
        });
        const recovery = createCentralCompatibilityRecovery({
            confirm: {},
            localDatabase: {},
            rebuilder: {},
            services: {
                appLifecycle: {},
                API: {},
                replicator: {
                    runWithActiveReplicatorContext: vi.fn(async (task: (context: unknown) => unknown) =>
                        task(replacementContext)
                    ),
                },
                tweakValue: { askResolvingMismatched },
            },
        } as never);

        await recovery.handleReplicationFailure({
            context: failedContext,
            setting: {},
            outcome,
            showMessage: false,
            interaction: NO_INTERACTION,
        } as never);
        expect(askResolvingMismatched).not.toHaveBeenCalled();

        await recovery.handleReplicationFailure({
            context: failedContext,
            setting: {},
            outcome,
            showMessage: false,
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
            showMessage: true,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        } as never);
        expect(askResolvingMismatched).toHaveBeenCalledWith(preferredTweakValue, expect.any(Function));
        const updatePreferredRemote = askResolvingMismatched.mock.calls[0][1] as (
            setting: Record<string, unknown>
        ) => Promise<boolean>;
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
            localDatabase: {},
            rebuilder: {},
            services: {
                appLifecycle: {},
                API: {},
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
            showMessage: true,
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
            localDatabase: {},
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
            showMessage: true,
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
        const remoteDatabase = { close: vi.fn(async () => undefined) };
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
        const localDatabase = { localDatabase: {}, clearCaches: vi.fn() };
        const recovery = createCentralCompatibilityRecovery({
            confirm: { confirmWithMessage: vi.fn(async () => "Cleanup") },
            localDatabase,
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
        expect(close).toHaveBeenCalledOnce();
        expect(close.mock.invocationCallOrder[0]).toBeLessThan(activityFinished.mock.invocationCallOrder[0]);
    });
});
