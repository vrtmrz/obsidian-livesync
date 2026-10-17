import { describe, expect, it } from "vitest";
import { createFileContentHashBenchmarkOperations } from "./reviewHarnessFileContentHashBenchmarkRuntime";

describe("Review Harness file content hash benchmark adapter", () => {
    it("uses the packaged SHA-256 helper and xxHash64 engine with fixed Blob content", async () => {
        const operations = await createFileContentHashBenchmarkOperations();
        const content = operations.createInput(4 * 1024);

        expect(operations.xxHashInitialisationMs).toBeGreaterThanOrEqual(0);
        expect(await operations.sha256(content)).toMatch(/^sha256:/u);
        expect(typeof (await operations.xxHash64(content))).toBe("bigint");
        expect(await operations.sha256(content)).toBe(await operations.sha256(content));
        expect(await operations.xxHash64(content)).toBe(await operations.xxHash64(content));
    });
});
