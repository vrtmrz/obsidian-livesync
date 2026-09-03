import { describe, expect, it, vi } from "vitest";
import {
    runConfiguredStartupLifecycle,
    runStartupEntryLifecycle,
    type StartupEntryLifecycleRuntime,
} from "./configuredStartupLifecycle";
import type { ConfiguredStartupLifecycleOperations } from "./types";

function createRuntime(events: string[] = []): ConfiguredStartupLifecycleOperations {
    return {
        databaseReady: true,
        reportDatabaseNotReady: vi.fn(() => events.push("database-not-ready")),
        hasCompromisedChunks: vi.fn(async () => {
            events.push("compromised-chunks");
            return true;
        }),
        hasIncompleteDocuments: vi.fn(async () => {
            events.push("incomplete-documents");
            return true;
        }),
        waitForCompatibilityReview: vi.fn(async () => {
            events.push("compatibility-review");
        }),
        runDoctor: vi.fn(async () => {
            events.push("doctor");
            return true;
        }),
        migrateBulkSend: vi.fn(async () => {
            events.push("bulk-send");
        }),
    };
}

describe("runConfiguredStartupLifecycle", () => {
    it("runs all configured checks in their established order", async () => {
        const events: string[] = [];

        await expect(runConfiguredStartupLifecycle(createRuntime(events))).resolves.toBe(true);

        expect(events).toEqual([
            "compromised-chunks",
            "incomplete-documents",
            "compatibility-review",
            "doctor",
            "bulk-send",
        ]);
    });

    it("does not invoke later operations after database or integrity failure", async () => {
        const events: string[] = [];
        const runtime = createRuntime(events);
        Object.assign(runtime, { databaseReady: false });

        await expect(runConfiguredStartupLifecycle(runtime)).resolves.toBe(false);
        expect(events).toEqual(["database-not-ready"]);

        Object.assign(runtime, { databaseReady: true });
        vi.mocked(runtime.hasCompromisedChunks).mockImplementation(async () => {
            events.push("compromised-chunks");
            return false;
        });
        await expect(runConfiguredStartupLifecycle(runtime)).resolves.toBe(false);
        expect(events).toEqual(["database-not-ready", "compromised-chunks"]);
        expect(runtime.hasIncompleteDocuments).not.toHaveBeenCalled();
    });

    it("does not invoke later operations when incomplete-document checking fails", async () => {
        const events: string[] = [];
        const runtime = createRuntime(events);
        vi.mocked(runtime.hasIncompleteDocuments).mockImplementation(async () => {
            events.push("incomplete-documents");
            return false;
        });

        await expect(runConfiguredStartupLifecycle(runtime)).resolves.toBe(false);

        expect(events).toEqual(["compromised-chunks", "incomplete-documents"]);
        expect(runtime.waitForCompatibilityReview).not.toHaveBeenCalled();
        expect(runtime.runDoctor).not.toHaveBeenCalled();
        expect(runtime.migrateBulkSend).not.toHaveBeenCalled();
    });

    it("does not migrate bulk-send settings when Config Doctor fails", async () => {
        const events: string[] = [];
        const runtime = createRuntime(events);
        vi.mocked(runtime.runDoctor).mockImplementation(async () => {
            events.push("doctor");
            return false;
        });

        await expect(runConfiguredStartupLifecycle(runtime)).resolves.toBe(false);

        expect(events).toEqual(["compromised-chunks", "incomplete-documents", "compatibility-review", "doctor"]);
        expect(runtime.migrateBulkSend).not.toHaveBeenCalled();
    });

    it("calls Config Doctor without start-up-only arguments", async () => {
        const runtime = createRuntime();

        await runConfiguredStartupLifecycle(runtime);

        expect(runtime.runDoctor).toHaveBeenCalledWith();
    });
});

describe("runStartupEntryLifecycle", () => {
    it("invites an unconfigured Vault and stops configured start-up", () => {
        const inviteToOnboarding = vi.fn();
        const runtime: StartupEntryLifecycleRuntime = {
            configured: false,
            inviteToOnboarding,
        };

        expect(runStartupEntryLifecycle(runtime)).toBe(false);
        expect(inviteToOnboarding).toHaveBeenCalledOnce();
    });

    it("admits a configured Vault without inviting it to onboarding", () => {
        const inviteToOnboarding = vi.fn();

        expect(
            runStartupEntryLifecycle({
                configured: true,
                inviteToOnboarding,
            })
        ).toBe(true);
        expect(inviteToOnboarding).not.toHaveBeenCalled();
    });
});
