import { describe, expect, it, vi } from "vitest";
import { InjectableReplicationService } from "@vrtmrz/livesync-commonlib/compat/services/implements/injectable/InjectableReplicationService";
import { ServiceContext } from "@vrtmrz/livesync-commonlib/compat/services/base/ServiceBase";
import { evaluateCompatibilityPause, legacyDatabaseCompatibilityVersionKey } from "./databaseCompatibility.ts";

function migrationState(overrides: Record<string, unknown> = {}) {
    return {
        sourceVersion: 2,
        targetVersion: 2,
        isNewVault: false,
        isFromFutureSchema: false,
        changed: false,
        requiresSyncReview: false,
        reviewReasons: [],
        ...overrides,
    } as never;
}

describe("database compatibility evaluation", () => {
    it("initialises a new Vault without presenting an upgrade review", () => {
        const result = evaluateCompatibilityPause({
            acknowledgedVersion: null,
            currentVersion: 12,
            migrationState: migrationState({ isNewVault: true }),
            legacyReviewMessage: "",
        });

        expect(result).toEqual({ initialiseAcknowledgedVersion: true });
    });

    it("allows an older acknowledged version to be reviewed and resumed", () => {
        const result = evaluateCompatibilityPause({
            acknowledgedVersion: "11",
            currentVersion: 12,
            migrationState: migrationState(),
            legacyReviewMessage: "",
        });

        expect(result.pause).toEqual({
            resumable: true,
            reasons: [
                {
                    source: "database-version",
                    state: "upgrade",
                    acknowledgedVersion: 11,
                    currentVersion: 12,
                    resumable: true,
                },
            ],
        });
        expect(result.initialiseAcknowledgedVersion).toBe(false);
    });

    it("does not permit an older implementation to acknowledge a newer database version", () => {
        const result = evaluateCompatibilityPause({
            acknowledgedVersion: "13",
            currentVersion: 12,
            migrationState: migrationState(),
            legacyReviewMessage: "",
        });

        expect(result.pause?.resumable).toBe(false);
        expect(result.pause?.reasons[0]).toMatchObject({
            source: "database-version",
            state: "downgrade",
            acknowledgedVersion: 13,
            currentVersion: 12,
        });
    });

    it("requires review when an existing Vault has no valid acknowledged version", () => {
        for (const acknowledgedVersion of [null, "invalid"]) {
            const result = evaluateCompatibilityPause({
                acknowledgedVersion,
                currentVersion: 12,
                migrationState: migrationState(),
                legacyReviewMessage: "",
            });
            expect(result.pause?.resumable).toBe(true);
            expect(result.pause?.reasons[0]).toMatchObject({ source: "database-version" });
        }
    });

    it("does not permit a future settings schema to be acknowledged by an older implementation", () => {
        const result = evaluateCompatibilityPause({
            acknowledgedVersion: "12",
            currentVersion: 12,
            migrationState: migrationState({
                sourceVersion: 3,
                targetVersion: 2,
                isFromFutureSchema: true,
                requiresSyncReview: true,
            }),
            legacyReviewMessage: "",
        });

        expect(result.pause).toEqual({
            resumable: false,
            reasons: [
                {
                    source: "settings-schema",
                    sourceVersion: 3,
                    currentVersion: 2,
                    isFromFutureSchema: true,
                    resumable: false,
                    reviewReasons: [],
                },
            ],
        });
    });

    it("retains a settings migration review in the host compatibility reason", () => {
        const reviewReasons = [
            {
                code: "legacy-update-review-pending",
                fromVersion: 9,
                toVersion: 10,
            },
        ];
        const result = evaluateCompatibilityPause({
            acknowledgedVersion: "12",
            currentVersion: 12,
            migrationState: migrationState({
                sourceVersion: 9,
                targetVersion: 10,
                requiresSyncReview: true,
                reviewReasons,
            }),
            legacyReviewMessage: "",
        });

        expect(result.pause?.reasons).toContainEqual({
            source: "settings-schema",
            sourceVersion: 9,
            currentVersion: 10,
            isFromFutureSchema: false,
            resumable: true,
            reviewReasons,
        });
    });

    it("compatibility: retains an earlier unstructured review when no structured reason can be reconstructed", () => {
        const result = evaluateCompatibilityPause({
            acknowledgedVersion: "12",
            currentVersion: 12,
            migrationState: migrationState(),
            legacyReviewMessage: "Review an earlier compatibility change.",
        });

        expect(result.pause).toEqual({
            resumable: true,
            reasons: [
                {
                    source: "legacy-review",
                    message: "Review an earlier compatibility change.",
                    resumable: true,
                },
            ],
        });
    });

    it("compatibility: scopes the earlier review marker to the Vault", () => {
        expect(legacyDatabaseCompatibilityVersionKey("Example Vault")).toBe("obsidian-live-sync-verExample Vault");
    });
});

describe("packaged Commonlib compatibility gate", () => {
    it("prevents replication while the compatibility review remains pending", async () => {
        const openReplication = vi.fn().mockResolvedValue(true);
        const runFiniteReplicationActivity = vi.fn(async (task: () => unknown) => await task());
        const dependencies = {
            APIService: { isOnline: true, addLog: vi.fn() },
            appLifecycleService: {
                isReady: () => true,
                getUnresolvedMessages: Object.assign(vi.fn().mockResolvedValue([]), { addHandler: vi.fn() }),
            },
            databaseService: {},
            fileProcessingService: { commitPendingFileEvents: vi.fn().mockResolvedValue(true) },
            replicatorService: {
                getActiveReplicator: () => ({ openReplication }),
                runFiniteReplicationActivity,
            },
            settingService: {
                currentSettings: () => ({ versionUpFlash: "Review the database compatibility change." }),
            },
        };
        const service = new InjectableReplicationService(new ServiceContext(), dependencies as never);

        await expect(service.replicate(true)).resolves.toBe(false);

        expect(runFiniteReplicationActivity).not.toHaveBeenCalled();
        expect(openReplication).not.toHaveBeenCalled();
    });
});
