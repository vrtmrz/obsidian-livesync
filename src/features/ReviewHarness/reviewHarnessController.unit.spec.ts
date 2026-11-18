import { describe, expect, it, vi } from "vitest";
import { NEW_VAULT_SETTINGS, type SettingsMigrationState } from "@vrtmrz/livesync-commonlib/settings";
import type { CompatibilityPause } from "@/serviceFeatures/compatibilityReview.evaluation.ts";
import { ReviewHarnessController, type ReviewHarnessRuntime } from "./reviewHarnessController";
import type {
    DatabaseProbeAction,
    DatabaseProbeMode,
    DatabaseProbeSnapshot,
    ReviewHarnessDatabaseProbe,
} from "./reviewHarnessDatabaseProbeTypes";

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
                reviewReasons: migration().reviewReasons,
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
        runVaultRoundTrip: vi.fn(async () => ({
            status: "passed" as const,
            detail: "The owned fixture tree was exercised and removed.",
            observations: [],
        })),
        runIdBenchmark: vi.fn(async () => ({
            status: "passed" as const,
            detail: "ID generation measurements completed.",
            observations: ["Chunk 256 B: 1000 IDs total=43.00 ms; per ID=0.0430 ms"],
        })),
        runFileContentHashBenchmark: vi.fn(async () => ({
            status: "passed" as const,
            detail: "File content hash measurements completed.",
            observations: ["SHA-256, 4 KiB: median=1.00 ms; range=1.00–1.00 ms"],
        })),
        runDatabaseAbortDiagnostic: vi.fn(async () => ({
            status: "observed" as const,
            detail: "Abort injection and read states were observed.",
            observations: [
                "idb.abort.injected=true; operation=pending; drain=false",
                "indexeddb.abort.injected=true; operation=pending; drain=false",
            ],
        })),
        async readContinuation() {
            return this.continuation;
        },
        async writeContinuation(value) {
            this.events.push("write");
            this.continuation = value;
        },
        async deleteContinuation() {
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

function createDatabaseProbe(initialMode: DatabaseProbeMode | null = null): {
    readonly probe: ReviewHarnessDatabaseProbe;
    setSnapshot(snapshot: DatabaseProbeSnapshot): void;
} {
    let snapshot: DatabaseProbeSnapshot = {
        mode: initialMode,
        phase: initialMode ? "observing" : "idle",
        instruction: "Follow the current diagnostic step.",
        expected: "Listener state and event counts are observations.",
        availableActions: initialMode ? ["check", "finish", "cancel"] : [],
        result: { status: initialMode ? "waiting-for-user" : "idle", detail: "Ready", observations: [] },
    };
    const listeners = new Set<() => void>();
    const update = (next: DatabaseProbeSnapshot) => {
        snapshot = next;
        for (const listener of listeners) {
            listener();
        }
    };
    const probe: ReviewHarnessDatabaseProbe = {
        snapshot: vi.fn(() => snapshot),
        subscribe: vi.fn((listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }),
        start: vi.fn(async (mode) => {
            update({
                mode,
                phase: "observing",
                instruction: "Return to the app and check the fixture connection.",
                expected: "A zero-event count is still useful evidence.",
                availableActions:
                    mode === "controlled"
                        ? ["close-native", "check", "finish", "cancel"]
                        : ["check", "finish", "cancel"],
                result: {
                    status: "waiting-for-user",
                    detail: "Observation is active.",
                    observations: ["fixture-native.close: listener=registered; received=0; last=none"],
                },
            });
        }),
        perform: vi.fn(async (action: DatabaseProbeAction) => {
            const finished = action === "finish" || action === "cancel";
            let availableActions: readonly DatabaseProbeAction[];
            if (finished) {
                availableActions = [];
            } else if (action === "close-native") {
                availableActions = ["check", "reopen", "finish", "cancel"];
            } else if (action === "reopen") {
                availableActions = ["close-native", "check", "finish", "cancel"];
            } else if (snapshot.availableActions.includes("reopen")) {
                availableActions = ["check", "reopen", "finish", "cancel"];
            } else {
                availableActions = ["check", "finish", "cancel"];
            }
            update({
                ...snapshot,
                phase: finished ? "complete" : "observing",
                availableActions: finished ? [] : availableActions,
                result: {
                    status:
                        action === "cancel" ? "cancelled" : action === "finish" ? "not-observed" : "waiting-for-user",
                    detail: action === "finish" ? "No connection failure was observed." : "Observation is active.",
                    observations: [...snapshot.result.observations, `action=${action}`],
                },
            });
        }),
        dispose: vi.fn(async () => undefined),
    };
    return { probe, setSnapshot: update };
}

describe("ReviewHarnessController", () => {
    it("runs the automatic settings check", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runAutomaticScenarios();

        expect(controller.snapshot().results["settings-lifecycle"].status).toBe("passed");
        expect(controller.snapshot().results["vault-round-trip"].status).toBe("idle");
        expect(controller.snapshot().results["compatibility-review"].status).toBe("idle");
        expect(controller.snapshot().results["file-content-hash-performance"].status).toBe("idle");
    });

    it("keeps all database diagnostics out of Automatic and Full review", async () => {
        const runtime = createRuntime();
        const { probe } = createDatabaseProbe();
        runtime.databaseProbe = probe;
        const controller = new ReviewHarnessController(runtime);

        await controller.runAutomaticScenarios();
        await controller.runAllScenarios();

        expect(probe.start).not.toHaveBeenCalled();
        expect(runtime.runDatabaseAbortDiagnostic).not.toHaveBeenCalled();
        expect(controller.snapshot().results["database-connection-loss"].status).toBe("idle");
        expect(controller.snapshot().results["database-background-events"].status).toBe("idle");
        expect(controller.snapshot().results["database-transaction-abort"].status).toBe("idle");
    });

    it("dispatches individual probe modes and includes live observations in the report", async () => {
        const runtime = createRuntime();
        const { probe } = createDatabaseProbe();
        runtime.databaseProbe = probe;
        const controller = new ReviewHarnessController(runtime);

        await controller.runScenario("database-connection-loss");
        expect(probe.start).toHaveBeenNthCalledWith(1, "controlled");
        expect(controller.snapshot().databaseProbe).toMatchObject({ mode: "controlled", phase: "observing" });
        expect(controller.snapshot().results["database-connection-loss"].observations).toContain(
            "fixture-native.close: listener=registered; received=0; last=none"
        );

        await controller.performDatabaseProbeAction("close-native");
        await controller.performDatabaseProbeAction("check");
        await controller.performDatabaseProbeAction("reopen");
        await controller.performDatabaseProbeAction("check");
        await controller.performDatabaseProbeAction("finish");
        expect(controller.snapshot().results["database-connection-loss"].status).toBe("not-observed");
        expect(probe.perform).toHaveBeenNthCalledWith(1, "close-native");
        expect(probe.perform).toHaveBeenNthCalledWith(2, "check");
        expect(probe.perform).toHaveBeenNthCalledWith(3, "reopen");
        expect(probe.perform).toHaveBeenNthCalledWith(4, "check");
        expect(probe.perform).toHaveBeenNthCalledWith(5, "finish");

        await controller.runScenario("database-background-events");
        expect(probe.start).toHaveBeenNthCalledWith(2, "background");
        await controller.copyReport();

        const report = vi.mocked(runtime.copyText).mock.calls[0][0];
        expect(report).toContain("fixture-native.close: listener=registered; received=0; last=none");
        expect(report).toContain(
            "The diagnostic is observational; it does not perform or verify automatic LiveSync recovery."
        );
        expect(report).toContain(
            "The controlled native close is diagnostic input and does not emit a native close event."
        );
        expect(report).toContain("No observed failure does not establish that a fix worked.");
        expect(report).toContain("Database connection-loss diagnostic (database-connection-loss)");
        expect(report).toContain("Database background-events diagnostic (database-background-events)");
    });

    it("marks a database diagnostic unsupported when the optional runtime is absent", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runScenario("database-connection-loss");

        expect(controller.snapshot().databaseProbe).toBeNull();
        expect(controller.snapshot().results["database-connection-loss"]).toMatchObject({
            status: "unsupported",
            detail: "The database diagnostic is unavailable in this runtime.",
        });
    });

    it("blocks other work during an active probe but allows cancellation during asynchronous start", async () => {
        const runtime = createRuntime();
        const { probe } = createDatabaseProbe("controlled");
        runtime.databaseProbe = probe;
        const activeController = new ReviewHarnessController(runtime);

        await activeController.runScenario("vault-round-trip");
        await activeController.runScenario("database-background-events");
        await activeController.openCompatibilityReview();
        await activeController.prepareCompatibilityReviewRestart();
        expect(runtime.runVaultRoundTrip).not.toHaveBeenCalled();
        expect(runtime.openCompatibilityReview).not.toHaveBeenCalled();
        expect(runtime.restart).not.toHaveBeenCalled();
        expect(probe.start).not.toHaveBeenCalled();

        const idleRuntime = createRuntime();
        const { probe: idleDatabaseProbe, setSnapshot: setIdleSnapshot } = createDatabaseProbe();
        idleRuntime.databaseProbe = idleDatabaseProbe;
        let finishStart!: () => void;
        const pendingStart = new Promise<void>((resolve) => {
            finishStart = resolve;
        });
        idleDatabaseProbe.start = vi.fn(async (mode) => {
            setIdleSnapshot({
                ...idleDatabaseProbe.snapshot(),
                mode,
                phase: "preparing",
                availableActions: ["cancel"],
                result: { status: "running", detail: "Preparing", observations: [] },
            });
            await pendingStart;
        });
        const controller = new ReviewHarnessController(idleRuntime);
        const starting = controller.runScenario("database-connection-loss");
        await Promise.resolve();

        expect(controller.snapshot().databaseProbe?.availableActions).toEqual(["cancel"]);
        await controller.performDatabaseProbeAction("cancel");
        expect(idleDatabaseProbe.perform).toHaveBeenCalledWith("cancel");

        finishStart();
        await starting;
        expect(controller.snapshot().results["database-connection-loss"].status).toBe("cancelled");
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

    it("runs ID measurements on request and includes their units in the copied report", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runAutomaticScenarios();
        expect(runtime.runIdBenchmark).not.toHaveBeenCalled();

        await controller.runScenario("id-generation-performance");
        await controller.copyReport();

        expect(runtime.runIdBenchmark).toHaveBeenCalledOnce();
        expect(controller.snapshot().results["id-generation-performance"].status).toBe("passed");
        expect(vi.mocked(runtime.copyText).mock.calls[0][0]).toContain("1000 IDs total=43.00 ms; per ID=0.0430 ms");
        expect(runtime.runVaultRoundTrip).not.toHaveBeenCalled();
        expect(runtime.events).toEqual([]);
        expect(runtime.continuation).toBeNull();
    });

    it("excludes an unexpected measurement error from the copied report", async () => {
        const runtime = createRuntime();
        runtime.runIdBenchmark = vi.fn().mockRejectedValue(new Error("private measurement error"));
        const controller = new ReviewHarnessController(runtime);

        await controller.runScenario("id-generation-performance");

        expect(controller.snapshot().results["id-generation-performance"].status).toBe("failed");
        expect(controller.createReport()).not.toContain("private measurement error");
        expect(runtime.reportError).toHaveBeenCalledOnce();
    });

    it("runs file content hash measurements on request without running them automatically", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runAutomaticScenarios();
        expect(runtime.runFileContentHashBenchmark).not.toHaveBeenCalled();

        await controller.runScenario("file-content-hash-performance");

        expect(runtime.runFileContentHashBenchmark).toHaveBeenCalledOnce();
        expect(controller.snapshot().results["file-content-hash-performance"]).toMatchObject({ status: "passed" });
        expect(runtime.runVaultRoundTrip).not.toHaveBeenCalled();
    });

    it("restarts after an abort observation only when the user requests it", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);
        expect(controller.canRestartAfterDatabaseAbortDiagnostic).toBe(false);
        controller.restartAfterDatabaseAbortDiagnostic();
        expect(runtime.restart).not.toHaveBeenCalled();

        await controller.runScenario("database-transaction-abort");
        expect(controller.canRestartAfterDatabaseAbortDiagnostic).toBe(true);
        expect(runtime.restart).not.toHaveBeenCalled();
        await controller.copyReport();
        expect(runtime.restart).not.toHaveBeenCalled();

        controller.restartAfterDatabaseAbortDiagnostic();
        expect(runtime.restart).toHaveBeenCalledOnce();
        expect(runtime.continuation).toBeNull();
    });

    it("runs the transaction-abort diagnostic only on request and copies its bounded observations", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runScenario("settings-lifecycle");
        await controller.runAutomaticScenarios();
        await controller.runAllScenarios();

        expect(runtime.runDatabaseAbortDiagnostic).not.toHaveBeenCalled();
        expect(controller.snapshot().results["database-transaction-abort"].status).toBe("idle");

        await controller.runScenario("database-transaction-abort");
        await controller.copyReport();

        expect(runtime.runDatabaseAbortDiagnostic).toHaveBeenCalledOnce();
        expect(controller.snapshot().results["database-transaction-abort"]).toEqual({
            status: "observed",
            detail: "Abort injection and read states were observed.",
            observations: [
                "idb.abort.injected=true; operation=pending; drain=false",
                "indexeddb.abort.injected=true; operation=pending; drain=false",
            ],
        });
        const report = vi.mocked(runtime.copyText).mock.calls[0][0];
        expect(report).toContain("Settings lifecycle (settings-lifecycle)");
        expect(report).toContain(
            "| Settings lifecycle (settings-lifecycle) | automatic | passed | Loaded an existing Vault"
        );
        expect(report).toContain("Database transaction-abort diagnostic (database-transaction-abort)");
        expect(report).toContain(
            "| Database transaction-abort diagnostic (database-transaction-abort) | manual | observed | Abort injection and read states were observed."
        );
        expect(report).toContain("idb.abort.injected=true; operation=pending; drain=false");
        expect(report).toContain("indexeddb.abort.injected=true; operation=pending; drain=false");
        expect(report).not.toContain("private-vault");
        expect(report).not.toContain("secret-note.md");
    });

    it("includes file content hash measurements in Full review", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.runAllScenarios();

        expect(runtime.runFileContentHashBenchmark).toHaveBeenCalledOnce();
        expect(controller.snapshot().results["file-content-hash-performance"].status).toBe("passed");
    });

    it("excludes an unexpected file content hash error from the copied report", async () => {
        const runtime = createRuntime();
        runtime.runFileContentHashBenchmark = vi.fn().mockRejectedValue(new Error("private benchmark content"));
        const controller = new ReviewHarnessController(runtime);

        await controller.runScenario("file-content-hash-performance");

        expect(controller.snapshot().results["file-content-hash-performance"].status).toBe("failed");
        expect(controller.createReport()).not.toContain("private benchmark content");
        expect(runtime.reportError).toHaveBeenCalledOnce();
    });

    it("does not overlap an ID measurement with another scenario", async () => {
        const runtime = createRuntime();
        let finish!: () => void;
        const pending = new Promise<void>((resolve) => {
            finish = resolve;
        });
        runtime.runIdBenchmark = vi.fn(async () => {
            await pending;
            return { status: "passed" as const, detail: "Measured", observations: [] };
        });
        const controller = new ReviewHarnessController(runtime);

        const running = controller.runScenario("id-generation-performance");
        await controller.runScenario("id-generation-performance");
        await controller.runScenario("vault-round-trip");

        expect(runtime.runIdBenchmark).toHaveBeenCalledOnce();
        expect(runtime.runVaultRoundTrip).not.toHaveBeenCalled();
        expect(controller.snapshot().running).toBe(true);
        finish();
        await running;
        expect(controller.snapshot().running).toBe(false);
    });

    it("deletes a one-shot continuation before exposing the resumed guided step", async () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "compatibility-review-2026-07-18T11:59:00.000Z",
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        const controller = new ReviewHarnessController(runtime);

        await controller.consumeContinuation();

        expect(runtime.events).toEqual(["delete"]);
        expect(controller.snapshot().results["compatibility-review"]).toMatchObject({
            status: "waiting-for-user",
        });
        expect(controller.snapshot().resumedRequestId).toBe("compatibility-review-2026-07-18T11:59:00.000Z");
    });

    it("does not copy rejected continuation values into the report", async () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "review-1",
            scenarioId: "/Users/reviewer/private-vault/secret-note.md",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        const controller = new ReviewHarnessController(runtime);

        await controller.consumeContinuation();

        expect(controller.snapshot().continuationError).toContain("private-vault");
        expect(controller.snapshot().results["compatibility-review"].detail).toBe(
            "The stored continuation was invalid and was removed."
        );
        expect(controller.createReport()).not.toContain("private-vault");
        expect(controller.createReport()).not.toContain("secret-note.md");
    });

    it("does not accept an injected request ID which could enter the report transcript", async () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "/Users/reviewer/private-vault/secret-note.md",
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        const controller = new ReviewHarnessController(runtime);

        await controller.consumeContinuation();

        expect(controller.snapshot().results["compatibility-review"].status).toBe("failed");
        expect(controller.createReport()).not.toContain("private-vault");
        expect(controller.createReport()).not.toContain("secret-note.md");
    });

    it("persists the fixed continuation before requesting restart", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);

        await controller.prepareCompatibilityReviewRestart();

        expect(runtime.events).toEqual(["write", "restart"]);
        expect(JSON.parse(runtime.continuation!)).toMatchObject({
            formatVersion: 1,
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
        });
    });

    it("waits for the continuation save before requesting restart", async () => {
        const runtime = createRuntime();
        let markSaveStarted!: () => void;
        const saveStarted = new Promise<void>((resolve) => {
            markSaveStarted = resolve;
        });
        let finishSave!: () => void;
        const saving = new Promise<void>((resolve) => {
            finishSave = resolve;
        });
        runtime.writeContinuation = vi.fn(async (value) => {
            runtime.events.push("write-started");
            markSaveStarted();
            await saving;
            runtime.continuation = value;
            runtime.events.push("write-saved");
        });
        const controller = new ReviewHarnessController(runtime);

        const preparing = controller.prepareCompatibilityReviewRestart();
        await saveStarted;

        expect(runtime.events).toEqual(["write-started"]);
        expect(runtime.restart).not.toHaveBeenCalled();
        expect(controller.snapshot().results["compatibility-review"].status).toBe("idle");

        finishSave();
        await preparing;

        expect(runtime.events).toEqual(["write-started", "write-saved", "restart"]);
        expect(controller.snapshot().results["compatibility-review"].status).toBe("waiting-for-user");
    });

    it("keeps the guided review retryable when saving its continuation fails", async () => {
        const runtime = createRuntime();
        const controller = new ReviewHarnessController(runtime);
        await controller.runScenario("compatibility-review");
        runtime.writeContinuation = vi.fn(async () => {
            runtime.events.push("write-failed");
            throw new Error("continuation save failed");
        });

        await expect(controller.prepareCompatibilityReviewRestart()).rejects.toThrow("continuation save failed");

        expect(runtime.events).toEqual(["write-failed"]);
        expect(runtime.restart).not.toHaveBeenCalled();
        expect(controller.snapshot().results["compatibility-review"].status).toBe("waiting-for-user");
    });

    it("waits for one continuation deletion before exposing it and coalesces concurrent consumption", async () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "compatibility-review-2026-07-18T11:59:00.000Z",
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        let markDeleteStarted!: () => void;
        const deleteStarted = new Promise<void>((resolve) => {
            markDeleteStarted = resolve;
        });
        let finishDelete!: () => void;
        const deleting = new Promise<void>((resolve) => {
            finishDelete = resolve;
        });
        runtime.readContinuation = vi.fn(async () => {
            runtime.events.push("read");
            return runtime.continuation;
        });
        runtime.deleteContinuation = vi.fn(async () => {
            runtime.events.push("delete-started");
            markDeleteStarted();
            await deleting;
            runtime.continuation = null;
            runtime.events.push("delete-finished");
        });
        const controller = new ReviewHarnessController(runtime);

        const firstConsumption = controller.consumeContinuation();
        const duplicateConsumption = controller.consumeContinuation();
        await deleteStarted;

        expect(duplicateConsumption).toBe(firstConsumption);
        expect(runtime.events).toEqual(["read", "delete-started"]);
        expect(controller.snapshot().resumedRequestId).toBeNull();
        expect(controller.snapshot().results["compatibility-review"].status).toBe("idle");

        finishDelete();
        await firstConsumption;

        expect(runtime.events).toEqual(["read", "delete-started", "delete-finished"]);
        expect(runtime.readContinuation).toHaveBeenCalledOnce();
        expect(runtime.deleteContinuation).toHaveBeenCalledOnce();
        expect(controller.snapshot().resumedRequestId).toBe("compatibility-review-2026-07-18T11:59:00.000Z");
        expect(controller.snapshot().results["compatibility-review"].status).toBe("waiting-for-user");
    });

    it("keeps a failed continuation deletion available for retry", async () => {
        const runtime = createRuntime();
        runtime.continuation = JSON.stringify({
            formatVersion: 1,
            requestId: "compatibility-review-2026-07-18T11:59:00.000Z",
            scenarioId: "compatibility-review",
            stage: "awaiting-restart",
            requestedAt: "2026-07-18T11:59:00.000Z",
        });
        runtime.deleteContinuation = vi
            .fn<ReviewHarnessRuntime["deleteContinuation"]>()
            .mockRejectedValueOnce(new Error("continuation delete failed"))
            .mockImplementation(async () => {
                runtime.events.push("delete");
                runtime.continuation = null;
            });
        const controller = new ReviewHarnessController(runtime);

        await expect(controller.consumeContinuation()).rejects.toThrow("continuation delete failed");

        expect(runtime.continuation).not.toBeNull();
        expect(controller.snapshot().resumedRequestId).toBeNull();
        expect(controller.snapshot().results["compatibility-review"].status).toBe("idle");

        await controller.consumeContinuation();

        expect(runtime.continuation).toBeNull();
        expect(controller.snapshot().resumedRequestId).toBe("compatibility-review-2026-07-18T11:59:00.000Z");
        expect(controller.snapshot().results["compatibility-review"].status).toBe("waiting-for-user");
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
