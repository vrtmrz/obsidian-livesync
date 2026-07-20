import { describe, expect, it } from "vitest";
import { NEW_VAULT_SETTINGS, type SettingsMigrationState } from "@vrtmrz/livesync-commonlib/settings";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import {
    REVIEW_HARNESS_SCENARIO_IDS,
    formatReviewHarnessReport,
    inspectCompatibilityReview,
    inspectSettingsLifecycle,
    parsePendingReviewRun,
} from "./reviewHarnessContract";

const preservedSyncSettings = {
    liveSync: true,
    syncOnSave: false,
    syncOnEditorSave: true,
    syncOnStart: false,
    syncOnFileOpen: true,
    syncAfterMerge: false,
    periodicReplication: true,
};

function migration(overrides: Partial<SettingsMigrationState> = {}): SettingsMigrationState {
    return {
        sourceVersion: 9,
        targetVersion: 10,
        isNewVault: false,
        isFromFutureSchema: false,
        changed: true,
        requiresSyncReview: true,
        reviewReasons: [
            {
                code: "legacy-update-review-pending",
                fromVersion: 9,
                toVersion: 10,
            },
        ],
        ...overrides,
    };
}

function compatibilityPause(): CompatibilityPause {
    return {
        resumable: true,
        reasons: [
            {
                source: "settings-schema",
                sourceVersion: 9,
                currentVersion: 10,
                isFromFutureSchema: false,
                resumable: true,
                reviewReasons: migration().reviewReasons,
            },
        ],
    };
}

describe("Review Harness contract", () => {
    it("accepts only a fixed one-shot restart continuation", () => {
        const pendingRun = {
            formatVersion: 1,
            requestId: "compatibility-review-2026-07-18T12:00:00.000Z",
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T12:00:00.000Z",
        };

        expect(parsePendingReviewRun(JSON.stringify(pendingRun))).toEqual({ pendingRun });
        expect(
            parsePendingReviewRun(
                JSON.stringify({ ...pendingRun, scenarioId: "arbitrary-command", command: "delete-vault" })
            )
        ).toEqual({ error: "Unknown Review Harness scenario: arbitrary-command" });
        expect(parsePendingReviewRun("not-json")).toEqual({ error: "Review Harness continuation is not valid JSON" });
        expect(REVIEW_HARNESS_SCENARIO_IDS).toEqual([
            "settings-lifecycle",
            "compatibility-review",
            "p2p-composition",
            "vault-round-trip",
        ]);
    });

    it("checks that an existing Vault exposes the seven synchronisation choices as booleans", () => {
        const result = inspectSettingsLifecycle({
            migration: migration(),
            settings: preservedSyncSettings,
            newVaultSettings: NEW_VAULT_SETTINGS,
        });

        expect(result.status).toBe("passed");
        expect(result.detail).toContain("existing Vault");
        expect(result.observations).toContain("liveSync=true");
        expect(result.observations).toContain("periodicReplication=true");
    });

    it("checks recommended values only for a genuinely new Vault", () => {
        const result = inspectSettingsLifecycle({
            migration: migration({
                sourceVersion: 10,
                targetVersion: 10,
                isNewVault: true,
                changed: false,
                requiresSyncReview: false,
                reviewReasons: [],
            }),
            settings: {
                ...preservedSyncSettings,
                syncMaxSizeInMB: NEW_VAULT_SETTINGS.syncMaxSizeInMB,
                chunkSplitterVersion: NEW_VAULT_SETTINGS.chunkSplitterVersion,
                usePluginSyncV2: NEW_VAULT_SETTINGS.usePluginSyncV2,
                handleFilenameCaseSensitive: NEW_VAULT_SETTINGS.handleFilenameCaseSensitive,
                E2EEAlgorithm: NEW_VAULT_SETTINGS.E2EEAlgorithm,
            },
            newVaultSettings: NEW_VAULT_SETTINGS,
        });

        expect(result.status).toBe("passed");
        expect(result.detail).toContain("new Vault recommendations");
    });

    it("requires the compatibility review controller to initialise when settings migration requires review", () => {
        expect(
            inspectSettingsLifecycle({
                migration: undefined,
                settings: preservedSyncSettings,
                newVaultSettings: NEW_VAULT_SETTINGS,
            }).status
        ).toBe("failed");

        expect(
            inspectCompatibilityReview({
                migration: migration(),
                reviewInitialised: false,
                pendingPause: undefined,
            })
        ).toEqual({
            status: "failed",
            detail: "The settings migration requires review, but the compatibility review was not initialised.",
            observations: [],
        });
    });

    it("distinguishes a completed compatibility review from an uninitialised controller", () => {
        const result = inspectCompatibilityReview({
            migration: migration(),
            reviewInitialised: true,
            pendingPause: undefined,
        });

        expect(result).toMatchObject({
            status: "passed",
            detail: "No compatibility review is pending on this device.",
        });
        expect(result.observations).toContain("compatibilityReviewInitialised=true");
    });

    it("reports only bounded compatibility evidence", () => {
        const pendingPause: CompatibilityPause = {
            resumable: true,
            reasons: [
                ...compatibilityPause().reasons,
                {
                    source: "legacy-review",
                    message: "/Users/reviewer/private-vault/secret-note.md",
                    resumable: true,
                },
            ],
        };

        const result = inspectCompatibilityReview({
            migration: migration(),
            reviewInitialised: true,
            pendingPause,
        });

        expect(result.status).toBe("passed");
        expect(result.observations).toContain("reasonSources=settings-schema,legacy-review");
        expect(result.observations).toContain("resumable=true");
        expect(result.observations.join("\n")).not.toContain("private-vault");
        expect(result.observations.join("\n")).not.toContain("secret-note.md");
    });

    it("formats a review report without accepting Vault or credential fields", () => {
        const report = formatReviewHarnessReport({
            generatedAt: "2026-07-18T12:30:00.000Z",
            environment: {
                pluginVersion: "1.0.0-beta.1",
                obsidianVersion: "1.13.1",
                platform: "ios",
                userAgent: "Obsidian|mobile\nreview",
                viewport: "390x844",
            },
            scenarios: [
                {
                    id: "compatibility-review",
                    title: "Compatibility review boundary",
                    mode: "guided",
                    status: "passed",
                    detail: "Compatibility pause confirmed",
                },
            ],
            transcript: [
                {
                    at: "2026-07-18T12:29:00.000Z",
                    event: "compatibility-review-completed",
                },
            ],
        });

        expect(report).toContain("## Self-hosted LiveSync Review Harness report");
        expect(report).toContain("Obsidian\\|mobile<br>review");
        expect(report).toContain("Compatibility review boundary (compatibility-review)");
        expect(report).toContain("was not transmitted");
        expect(report).not.toContain("Vault name");
        expect(report).not.toContain("credentials");
    });
});
