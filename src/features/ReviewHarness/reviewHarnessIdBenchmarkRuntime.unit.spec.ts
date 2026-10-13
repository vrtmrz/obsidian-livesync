import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@vrtmrz/livesync-commonlib/settings";
import { createIdBenchmarkOperations } from "./reviewHarnessIdBenchmarkRuntime";

describe("Review Harness benchmark implementation", () => {
    it("uses the packaged legacy and independent algorithms with isolated fixed settings", async () => {
        const originalDefaults = structuredClone(DEFAULT_SETTINGS);
        const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network access is forbidden"));
        try {
            const operations = await createIdBenchmarkOperations();
            const chunk = "r".repeat(256);
            const legacy = await operations.chunkId(chunk, false);
            const independent = await operations.chunkId(chunk, true);

            expect(legacy).toMatch(/^\+[0-9a-z]{1,13}$/u);
            expect(independent).toMatch(/^\+[0-9a-f]{64}$/u);
            expect(independent).toBe("+9223e53d99e80c29effee9e95e38ed168d13c14f717054f9e996a1cd0a597000");
            expect(await operations.chunkId(chunk, false)).toBe(legacy);
            expect(await operations.chunkId(chunk, true)).toBe(independent);
            expect(await operations.chunkId("s".repeat(256), true)).not.toBe(independent);

            const legacyPath = await operations.documentId("benchmark/path-1.md", false);
            const independentPath = await operations.documentId("benchmark/path-1.md", true);
            expect(legacyPath).toMatch(/^f:[0-9a-f]{64}$/u);
            expect(independentPath).toMatch(/^f:[0-9a-f]{64}$/u);
            expect(legacyPath).not.toBe(independentPath);
            expect(await operations.documentId("benchmark/path-1.md", true)).toBe(independentPath);

            const second = await createIdBenchmarkOperations();
            expect(await second.chunkId(chunk, true)).toBe(independent);
            expect(await operations.deriveKey()).toMatch(/^[0-9a-f]{64}$/u);
            expect(fetch).not.toHaveBeenCalled();
            expect(DEFAULT_SETTINGS).toEqual(originalDefaults);
        } finally {
            fetch.mockRestore();
        }
    });
});
