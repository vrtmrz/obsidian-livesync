import { describe, expect, it } from "vitest";
import {
    REVIEW_HARNESS_FILE_CONTENT_HASH_INPUTS,
    createFixedFileContentHashInput,
    runReviewHarnessFileContentHashBenchmark,
    type FileContentHashBenchmarkOperations,
} from "./reviewHarnessFileContentHashBenchmark";

function fixture() {
    let elapsed = 0;
    let activeCalls = 0;
    let maximumConcurrentCalls = 0;
    let yieldCount = 0;
    const contentSizes = new WeakMap<Blob, number>();
    const contentBySize = new Map<number, Blob>();
    const callCounts = new Map<string, number>();
    const observedInputs = new Map<string, Blob[]>();
    const operations: FileContentHashBenchmarkOperations = {
        xxHashInitialisationMs: 12.5,
        createInput: (bytes) => {
            elapsed += 10000;
            const content = new Blob([new Uint8Array(4)]);
            contentSizes.set(content, bytes);
            contentBySize.set(bytes, content);
            return content;
        },
        sha256: async (content) => {
            await measure("SHA-256", content);
            return `sha256:${contentSizes.get(content)!}`;
        },
        xxHash64: async (content) => {
            await measure("xxHash64", content);
            return BigInt(contentSizes.get(content)!);
        },
    };

    async function measure(algorithm: string, content: Blob): Promise<void> {
        activeCalls++;
        maximumConcurrentCalls = Math.max(maximumConcurrentCalls, activeCalls);
        const bytes = contentSizes.get(content)!;
        const key = `${algorithm}:${bytes}`;
        const count = callCounts.get(key) ?? 0;
        callCounts.set(key, count + 1);
        observedInputs.set(key, [...(observedInputs.get(key) ?? []), content]);
        const durations =
            bytes === 4 * 1024
                ? algorithm === "SHA-256"
                    ? [100, 1, 3, 5]
                    : [200, 11, 13, 15]
                : algorithm === "SHA-256"
                  ? [1, 3, 5]
                  : [11, 13, 15];
        await Promise.resolve();
        elapsed += durations[count];
        activeCalls--;
    }

    return {
        operations,
        now: () => elapsed,
        yieldControl: async () => {
            yieldCount++;
            await Promise.resolve();
        },
        inputs: () => ({ contentBySize, callCounts, observedInputs, yieldCount, maximumConcurrentCalls }),
    };
}

describe("Review Harness file content hash measurements", () => {
    it("measures fixed Blob inputs with separate initialisation, warm-up, and sample ranges", async () => {
        const f = fixture();
        const result = await runReviewHarnessFileContentHashBenchmark(f.operations, { now: f.now }, f.yieldControl);
        const report = result.observations.join("\n");

        expect(result.status).toBe("passed");
        expect(result.detail).toBe("File content hash measurements completed.");
        expect([...f.inputs().contentBySize.keys()]).toEqual(
            REVIEW_HARNESS_FILE_CONTENT_HASH_INPUTS.map(({ bytes }) => bytes)
        );
        expect(Object.fromEntries(f.inputs().callCounts)).toEqual({
            "SHA-256:4096": 4,
            "xxHash64:4096": 4,
            ...Object.fromEntries(
                REVIEW_HARNESS_FILE_CONTENT_HASH_INPUTS.slice(1).flatMap(({ bytes }) => [
                    [`SHA-256:${bytes}`, 3],
                    [`xxHash64:${bytes}`, 3],
                ])
            ),
        });
        expect(f.inputs().yieldCount).toBe(30);
        expect(f.inputs().maximumConcurrentCalls).toBe(1);
        for (const { bytes } of REVIEW_HARNESS_FILE_CONTENT_HASH_INPUTS) {
            for (const algorithm of ["SHA-256", "xxHash64"]) {
                expect(f.inputs().observedInputs.get(`${algorithm}:${bytes}`)?.every(
                    (content) => content === f.inputs().contentBySize.get(bytes)
                )).toBe(true);
            }
        }
        expect(report).toContain("xxHash64 engine initialisation: 12.50 ms; measured separately.");
        expect(report).toContain(
            "Warm-up on 4 KiB, one call per algorithm: SHA-256=100.00 ms; xxHash64=200.00 ms; excluded from samples."
        );
        expect(report).toContain("SHA-256, 4 KiB: median=3.00 ms; range=1.00–5.00 ms.");
        expect(report).toContain("xxHash64, 4 KiB: median=13.00 ms; range=11.00–15.00 ms.");
        expect(report).toContain("Each algorithm has three samples per input.");
        expect(report).not.toContain("sha256:4096");
        expect(report).not.toContain("4096n");
    });

    it("uses the same deterministic byte sequence for short and long inputs", async () => {
        const shortInput = createFixedFileContentHashInput(4 * 1024);
        const longInput = createFixedFileContentHashInput(64 * 1024);

        expect(shortInput.size).toBe(4 * 1024);
        expect(longInput.size).toBe(64 * 1024);
        expect(new Uint8Array(await longInput.slice(0, shortInput.size).arrayBuffer())).toEqual(
            new Uint8Array(await shortInput.arrayBuffer())
        );
    });

    it("propagates hash failures without turning a partial run into a passed measurement", async () => {
        const f = fixture();
        const operations = {
            ...f.operations,
            sha256: async () => {
                throw new Error("synthetic hashing failure");
            },
        };

        await expect(
            runReviewHarnessFileContentHashBenchmark(operations, { now: f.now }, f.yieldControl)
        ).rejects.toThrow("synthetic hashing failure");
    });
});
