import { describe, expect, it, vi } from "vitest";
import { NEW_VAULT_SETTINGS, type SettingsMigrationState } from "@vrtmrz/livesync-commonlib/settings";
import type { CompatibilityPause } from "@/common/databaseCompatibility.ts";
import { ReviewHarnessController, type ReviewHarnessRuntime } from "./reviewHarnessController";

function migration(): SettingsMigrationState {
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
            },
        ],
    };
}

function createRuntime(): ReviewHarnessRuntime & {
    compatibilityReviewInitialised: boolean;
    compatibilityPause: CompatibilityPause | undefined;
    continuation: string | null;
    events: string[];
} {
    const services = {};
    const replicator = { env: { services } };
    const runtime: ReviewHarnessRuntime & {
        compatibilityReviewInitialised: boolean;
        compatibilityPause: CompatibilityPause | undefined;
        continuation: string | null;
        events: string[];
    } = {
        compatibilityReviewInitialised: true,
        compatibilityPause: compatibilityPause(),
        continuation: null,
        events: [],
        now: () => new Date("2026-07-18T12:00:00.000Z"),
        getSettings: () => ({
            liveSync: true,
            syncOnSave: false,
            syncOnEditorSave: true,
            syncOnStart: false,
            syncOnFileOpen: true,
            syncAfterMerge: false,
            periodicReplication: true,
        }),
        getNewVaultSettings: () => NEW_VAULT_SETTINGS,
        getSettingsMigrationState: () => migration(),
        isCompatibilityReviewInitialised() {
            return this.compatibilityReviewInitialised;
        },
        getCompatibilityPause() {
            return this.compatibilityPause;
        },
        openCompatibilityReview: vi.fn(async () => {
            runtime.events.push("open-compatibility-review");
            runtime.compatibilityPause = undefined;
        }),
        getP2PComposition: () => ({ first: replicator, second: replicator, expectedServices: services }),
        runVaultRoundTrip: vi.fn(async () => ({
            status: "passed" as const,
            detail: "The owned fixture tree was exercised and removed.",
            observations: [],
        })),
        readContinuation() {
            return this.continuation;
        },
        writeContinuation(value) {
            this.events.push("write");
            this.continuation = value;
        },
        deleteContinuation() {
            this.events.push("delete");
            this.continuation = null;
        },
        restart: vi.fn(),
        reportError: vi.fn(),
        copyText: vi.fn(async () => undefined),
        getEnvironment: () => ({
            pluginVersion: "1.0.0-beta.1",
            obsidianVersion: "1.13.1",
            platform: "desktop",
            userAgent: "test",
            viewport: "1280x720",
        }),
    };
    runtime.restart = vi.fn(() => runtime.events.push("restart"));
    return runtime;
}

describe("ReviewHarnessController", () => {
    it("runs the automatic settings and P2P composition checks", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runAutomaticScenarios();

        expect(controller.snapshot().results["settings-lifecycle"].status).toBe("passed");
        expect(controller.snapshot().results["p2p-composition"].status).toBe("passed");
        expect(controller.snapshot().results["vault-round-trip"].status).toBe("idle");
        expect(controller.snapshot().results["compatibility-review"].status).toBe("idle");
    });

    it("runs the Vault fixture scenario only when it is selected explicitly", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runAutomaticScenarios();
        expect(runtime.runVaultRoundTrip).not.toHaveBeenCalled();

        await controller.runScenario("vault-round-trip");
        expect(runtime.runVaultRoundTrip).toHaveBeenCalledOnce();
        expect(controller.snapshot().results["vault-round-trip"].status).toBe("passed");
    });

    it("does not copy unexpected runtime error details into the report", async () => {
        const runtime = createRuntime();
        runtime.runVaultRoundTrip = vi.fn(async () => {
            throw new Error("Failed below /Users/reviewer/private-vault/secret-note.md");
        });
        const controller = new ReviewHarnessController(runtime);

        await controller.runScenario("vault-round-trip");

        const result = controller.snapshot().results["vault-round-trip"];
        const report = controller.createReport();
        expect(result).toMatchObject({
            status: "failed",
            detail: "The scenario failed unexpectedly. Review the in-app logs for diagnostic details.",
        });
        expect(report).not.toContain("private-vault");
        expect(report).not.toContain("secret-note.md");
        expect(runtime.reportError).toHaveBeenCalledOnce();
    });

    it("deletes a one-shot continuation before exposing the resumed guided step", () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "compatibility-review-2026-07-18T11:59:00.000Z",
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        const controller = new ReviewHarnessController(runtime);

        controller.consumeContinuation();

        expect(runtime.events).toEqual(["delete"]);
        expect(controller.snapshot().results["compatibility-review"]).toMatchObject({
            status: "waiting-for-user",
        });
        expect(controller.snapshot().resumedRequestId).toBe(
            "compatibility-review-2026-07-18T11:59:00.000Z"
        );
    });

    it("does not copy rejected continuation values into the report", () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "review-1",
            scenarioId: "/Users/reviewer/private-vault/secret-note.md",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        const controller = new ReviewHarnessController(runtime);

        controller.consumeContinuation();

        expect(controller.snapshot().continuationError).toContain("private-vault");
        expect(controller.snapshot().results["compatibility-review"].detail).toBe(
            "The stored continuation was invalid and was removed."
        );
        expect(controller.createReport()).not.toContain("private-vault");
        expect(controller.createReport()).not.toContain("secret-note.md");
    });

    it("does not accept an injected request ID which could enter the report transcript", () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "/Users/reviewer/private-vault/secret-note.md",
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        const controller = new ReviewHarnessController(runtime);

        controller.consumeContinuation();

        expect(controller.snapshot().results["compatibility-review"].status).toBe("failed");
        expect(controller.createReport()).not.toContain("private-vault");
        expect(controller.createReport()).not.toContain("secret-note.md");
    });

    it("persists the fixed continuation before requesting restart", () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        controller.prepareCompatibilityReviewRestart();

        expect(runtime.events).toEqual(["write", "restart"]);
        expect(JSON.parse(runtime.continuation!)).toMatchObject({
            formatVersion: 1,
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
        });
    });

    it("passes only after the actual compatibility review clears its pause", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);
        await controller.runScenario("compatibility-review");

        await controller.openCompatibilityReview();

        expect(runtime.openCompatibilityReview).toHaveBeenCalledOnce();
        expect(controller.snapshot().results["compatibility-review"]).toMatchObject({
            status: "passed",
            detail: "The device-local compatibility pause was reviewed and cleared.",
        });
    });

    it("remains waiting when the actual compatibility review stays paused", async () => {
        const runtime = createRuntime();
        runtime.openCompatibilityReview = vi.fn(async () => undefined);
        const controller = new ReviewHarnessController(runtime);
        await controller.runScenario("compatibility-review");

        await controller.openCompatibilityReview();

        expect(controller.snapshot().results["compatibility-review"].status).toBe("waiting-for-user");
    });

    it("does not claim that a compatibility pause was cleared when none was pending", async () => {
        const runtime = createRuntime();
        runtime.compatibilityPause = undefined;
        const controller = new ReviewHarnessController(runtime);

        await controller.openCompatibilityReview();

        expect(controller.snapshot().results["compatibility-review"]).toMatchObject({
            status: "passed",
            detail: "No compatibility review is pending on this device.",
        });
    });

    it("copies a Markdown report after compatibility evidence is recorded", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);
        await controller.runScenario("compatibility-review");
        await controller.openCompatibilityReview();

        await controller.copyReport();

        expect(runtime.copyText).toHaveBeenCalledOnce();
        expect(vi.mocked(runtime.copyText).mock.calls[0][0]).toContain("Compatibility review boundary");
        expect(controller.snapshot().results["compatibility-review"].status).toBe("passed");
    });
});
