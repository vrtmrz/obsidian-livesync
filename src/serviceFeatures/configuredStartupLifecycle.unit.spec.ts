import { describe, expect, it, vi } from "vitest";
import {
    runConfiguredStartupLifecycle,
    runStartupEntryLifecycle,
    type ConfiguredStartupLifecycleRuntime,
} from "./configuredStartupLifecycle";

function createRuntime(): ConfiguredStartupLifecycleRuntime & { events: string[] } {
    const events: string[] = [];
    return {
        events,
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
    it("runs configured checks in order before allowing initialisation", async () => {
        const runtime = createRuntime();

        await expect(runConfiguredStartupLifecycle(runtime)).resolves.toBe(true);

        expect(runtime.events).toEqual(["compromised-chunks", "incomplete-documents", "doctor", "bulk-send"]);
    });

    it("stops before onboarding or checks when the database is unavailable", async () => {
        const runtime = createRuntime();
        runtime.databaseReady = false;

        await expect(runConfiguredStartupLifecycle(runtime)).resolves.toBe(false);

        expect(runtime.events).toEqual(["database-not-ready"]);
    });

    it("stops the configured sequence at the first failed check", async () => {
        const runtime = createRuntime();
        vi.mocked(runtime.hasIncompleteDocuments).mockImplementation(async () => {
            runtime.events.push("incomplete-documents");
            return false;
        });

        await expect(runConfiguredStartupLifecycle(runtime)).resolves.toBe(false);

        expect(runtime.events).toEqual(["compromised-chunks", "incomplete-documents"]);
    });
});

describe("runStartupEntryLifecycle", () => {
    it("offers onboarding and stops before database initialisation on an unconfigured Vault", () => {
        const inviteToOnboarding = vi.fn();

        expect(
            runStartupEntryLifecycle({
                configured: false,
                inviteToOnboarding,
            })
        ).toBe(false);

        expect(inviteToOnboarding).toHaveBeenCalledOnce();
    });

    it("allows a configured Vault to continue to database initialisation", () => {
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
