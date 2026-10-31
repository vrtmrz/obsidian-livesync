import { afterEach, describe, expect, it, vi } from "vitest";
import { xxhashNew } from "octagonal-wheels/hash/xxhash.js";
import { createFileContentHashBenchmarkOperations } from "./reviewHarnessFileContentHashBenchmarkRuntime";

vi.mock("octagonal-wheels/hash/xxhash.js", { spy: true });

afterEach(() => vi.restoreAllMocks());

describe("Review Harness file content hash benchmark adapter", () => {
    it("uses the packaged SHA-256 helper and xxHash64 engine with fixed Blob content", async () => {
        const operations = await createFileContentHashBenchmarkOperations();
        const content = operations.createInput(4 * 1024);

        expect(operations.xxHashInitialisationMs).toBeGreaterThanOrEqual(0);
        expect(await operations.sha256(content)).toMatch(/^sha256:/u);
        expect(typeof (await operations.xxHash64(content))).toBe("bigint");
        expect(await operations.sha256(content)).toBe(await operations.sha256(content));
        expect(await operations.xxHash64(content)).toBe(await operations.xxHash64(content));
        expect(xxhashNew).toHaveBeenCalledOnce();
    });

    it("rejects an engine without an xxHash64 operation", async () => {
        vi.mocked(xxhashNew).mockResolvedValueOnce({});

        await expect(createFileContentHashBenchmarkOperations()).rejects.toBeInstanceOf(TypeError);
    });

    it("rejects a hash result which is not a bigint", async () => {
        vi.mocked(xxhashNew).mockResolvedValueOnce({ h64Raw: () => 123 });
        const operations = await createFileContentHashBenchmarkOperations();

        await expect(operations.xxHash64(new Blob(["fixed content"]))).rejects.toBeInstanceOf(TypeError);
    });
});
