import { describe, expect, it, vi } from "vitest";
import {
    REVIEW_HARNESS_RENAMED_FILE,
    REVIEW_HARNESS_SOURCE_FILE,
    runReviewHarnessVaultRoundTrip,
    type ReviewHarnessVaultFixtureRuntime,
} from "./reviewHarnessVaultFixture";

interface FixtureFile {
    path: string;
    content: string;
}

function createRuntime(): ReviewHarnessVaultFixtureRuntime<FixtureFile> & {
    events: string[];
    rootExists: boolean;
} {
    const runtime: ReviewHarnessVaultFixtureRuntime<FixtureFile> & {
        events: string[];
        rootExists: boolean;
    } = {
        events: [],
        rootExists: false,
        confirmFixtureAccess: vi.fn(async () => true),
        fixtureRootExists() {
            return this.rootExists;
        },
        async createFixtureRoot() {
            this.events.push("create-root");
            this.rootExists = true;
        },
        async createFile(path, content) {
            this.events.push(`create-file:${path}`);
            return { path, content };
        },
        async readFile(file) {
            this.events.push(`read:${file.path}`);
            return file.content;
        },
        async modifyFile(file, content) {
            this.events.push(`modify:${file.path}`);
            file.content = content;
        },
        async renameFile(file, path) {
            this.events.push(`rename:${file.path}->${path}`);
            file.path = path;
        },
        filePath: (file) => file.path,
        async removeFixtureRoot() {
            this.events.push("remove-root");
            this.rootExists = false;
        },
    };
    return runtime;
}

describe("runReviewHarnessVaultRoundTrip", () => {
    it("does not inspect or mutate the Vault when access is declined", async () => {
        const runtime = createRuntime();
        vi.mocked(runtime.confirmFixtureAccess).mockResolvedValue(false);
        const exists = vi.spyOn(runtime, "fixtureRootExists");

        await expect(runReviewHarnessVaultRoundTrip(runtime)).resolves.toMatchObject({ status: "cancelled" });

        expect(exists).not.toHaveBeenCalled();
        expect(runtime.events).toEqual([]);
    });

    it("leaves a pre-existing fixture root untouched", async () => {
        const runtime = createRuntime();
        runtime.rootExists = true;

        await expect(runReviewHarnessVaultRoundTrip(runtime)).resolves.toMatchObject({ status: "failed" });

        expect(runtime.events).toEqual([]);
        expect(runtime.rootExists).toBe(true);
    });

    it("completes the round trip and removes its owned fixture root", async () => {
        const runtime = createRuntime();

        await expect(runReviewHarnessVaultRoundTrip(runtime)).resolves.toMatchObject({ status: "passed" });

        expect(runtime.events).toEqual([
            "create-root",
            `create-file:${REVIEW_HARNESS_SOURCE_FILE}`,
            `read:${REVIEW_HARNESS_SOURCE_FILE}`,
            `modify:${REVIEW_HARNESS_SOURCE_FILE}`,
            `read:${REVIEW_HARNESS_SOURCE_FILE}`,
            `rename:${REVIEW_HARNESS_SOURCE_FILE}->${REVIEW_HARNESS_RENAMED_FILE}`,
            `read:${REVIEW_HARNESS_RENAMED_FILE}`,
            "remove-root",
        ]);
        expect(runtime.rootExists).toBe(false);
    });

    it("removes an owned fixture root when an operation fails", async () => {
        const runtime = createRuntime();
        runtime.modifyFile = vi.fn(async () => {
            throw new Error("fixture write failed");
        });

        await expect(runReviewHarnessVaultRoundTrip(runtime)).rejects.toThrow("fixture write failed");

        expect(runtime.events[runtime.events.length - 1]).toBe("remove-root");
        expect(runtime.rootExists).toBe(false);
    });

    it("does not remove a root when creating it fails", async () => {
        const runtime = createRuntime();
        runtime.createFixtureRoot = vi.fn(async () => {
            throw new Error("root creation failed");
        });

        await expect(runReviewHarnessVaultRoundTrip(runtime)).rejects.toThrow("root creation failed");

        expect(runtime.events).toEqual([]);
    });
});
