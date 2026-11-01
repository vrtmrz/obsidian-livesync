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

import { createCentralCompatibilityRecovery } from "./centralCompatibilityRecovery";

describe("central compatibility recovery", () => {
    describe.each([
        { name: "unknown local features", version: 13, used_features: ["future-format-v7"] },
        { name: "a legacy local version", version: 11 },
        { name: "the current local version", version: 12 },
    ])("compatibility: cleaned IndexedDB remote with $name", (localVersion) => {
        it.each(["fetch", "unlock", "dismiss"] as const)(
            "uses standard recovery for an explicit %s choice without legacy cleanup",
            async (choice) => {
                chunkMocks.purgeUnreferencedChunks.mockClear();
                chunkMocks.balanceChunkPurgedDBs.mockClear();
                const markRemoteResolved = vi.fn(async (_setting: unknown) => undefined);
                const failedContext = {
                    provider: {},
                    replicator: { markRemoteResolved },
                    configurationIdentity: "cleaned-remote-test",
                };
                const setting = { useIndexedDBAdapter: true } as ObsidianLiveSyncSettings;
                const scheduleFetch = vi.fn(async () => undefined);
                const scheduleRestart = vi.fn();
                const getLocalDatabase = vi.fn(() => ({
                    localDatabase: {
                        get: vi.fn(async () => ({ _id: VERSIONING_DOCID, type: "versioninfo", ...localVersion })),
                    },
                }));
                const confirmWithMessage = vi.fn(async () => "Dismiss");
                const askSelectStringDialogue = vi.fn(
                    async (_message: string, choices: string[]) =>
                        choices[choice === "fetch" ? 0 : choice === "unlock" ? 1 : 2]
                );
                const recovery = createCentralCompatibilityRecovery({
                    confirm: { askSelectStringDialogue, confirmWithMessage },
                    getLocalDatabase,
                    rebuilder: { scheduleFetch },
                    services: {
                        appLifecycle: { scheduleRestart },
                        replicator: {
                            runWithActiveReplicatorContext: async (task: (context: unknown) => unknown) =>
                                await task(failedContext),
                        },
                    },
                } as never);

                const result = await recovery.handleReplicationFailure({
                    context: failedContext,
                    setting,
                    outcome: replicationFailed(new Error("cleaned"), {
                        reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED,
                    }),
                    progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
                    interaction: USER_INITIATED_REPLICATION_AUTHORITY,
                } as never);

                expect(result).toBe(false);
                expect(askSelectStringDialogue).toHaveBeenCalledOnce();
                const choices = askSelectStringDialogue.mock.calls[0][1];
                expect(choices).toHaveLength(3);
                expect(askSelectStringDialogue).toHaveBeenCalledWith(expect.any(String), choices, {
                    title: expect.any(String),
                    defaultAction: choices[2],
                    timeout: 60,
                });
                expect(confirmWithMessage).not.toHaveBeenCalled();
                expect(getLocalDatabase).not.toHaveBeenCalled();
                expect(chunkMocks.purgeUnreferencedChunks).not.toHaveBeenCalled();
                expect(chunkMocks.balanceChunkPurgedDBs).not.toHaveBeenCalled();
                expect(scheduleFetch).toHaveBeenCalledTimes(choice === "fetch" ? 1 : 0);
                expect(scheduleRestart).toHaveBeenCalledTimes(choice === "fetch" ? 1 : 0);
                expect(markRemoteResolved).toHaveBeenCalledTimes(choice === "unlock" ? 1 : 0);
                if (choice === "fetch") {
                    expect(scheduleFetch.mock.invocationCallOrder[0]).toBeLessThan(
                        scheduleRestart.mock.invocationCallOrder[0]
                    );
                }
                if (choice === "unlock") expect(markRemoteResolved).toHaveBeenCalledWith(setting);
            }
        );
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

    it.each([
        CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_LOCKED,
        CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED,
    ])("does not apply an unlock for a replaced failed publication: %s", async (reason) => {
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
            setting: { useIndexedDBAdapter: true },
            outcome: replicationFailed(new Error("locked"), {
                reason,
            }),
            progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
            interaction: USER_INITIATED_REPLICATION_AUTHORITY,
        } as never);

        expect(runWithActiveReplicatorContext).toHaveBeenCalledOnce();
        expect(failedMarkResolved).not.toHaveBeenCalled();
        expect(replacementMarkResolved).not.toHaveBeenCalled();
    });

    it.each([
        NO_INTERACTION,
        {
            kind: "permitted" as const,
            permissions: { ...USER_INITIATED_REPLICATION_AUTHORITY.permissions, failureRecovery: false },
        },
    ])("does not recover a cleaned remote without recovery authority: %j", async (interaction) => {
        const askSelectStringDialogue = vi.fn();
        const confirmWithMessage = vi.fn();
        const getLocalDatabase = vi.fn();
        const scheduleFetch = vi.fn();
        const scheduleRestart = vi.fn();
        const markRemoteResolved = vi.fn();
        const failedContext = {
            provider: {},
            replicator: { markRemoteResolved },
            configurationIdentity: "cleaned-remote-test",
        };
        const runWithActiveReplicatorContext = vi.fn(async (task: (context: unknown) => unknown) =>
            task(failedContext)
        );
        const recovery = createCentralCompatibilityRecovery({
            confirm: { askSelectStringDialogue, confirmWithMessage },
            getLocalDatabase,
            rebuilder: { scheduleFetch },
            services: {
                appLifecycle: { scheduleRestart },
                replicator: { runWithActiveReplicatorContext },
            },
        } as never);

        await expect(
            recovery.handleReplicationFailure({
                context: failedContext,
                setting: { useIndexedDBAdapter: true },
                outcome: replicationFailed(new Error("cleaned"), {
                    reason: CENTRAL_COMPATIBILITY_REJECTION_REASONS.NODE_CLEANED,
                }),
                progressPresentation: REPLICATION_PROGRESS_PRESENTATIONS.NOTICE,
                interaction,
            } as never)
        ).resolves.toBe(false);

        expect(askSelectStringDialogue).not.toHaveBeenCalled();
        expect(confirmWithMessage).not.toHaveBeenCalled();
        expect(getLocalDatabase).not.toHaveBeenCalled();
        expect(scheduleFetch).not.toHaveBeenCalled();
        expect(scheduleRestart).not.toHaveBeenCalled();
        expect(runWithActiveReplicatorContext).not.toHaveBeenCalled();
        expect(markRemoteResolved).not.toHaveBeenCalled();
    });
});
