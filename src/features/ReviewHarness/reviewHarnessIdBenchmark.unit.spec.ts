import { describe, expect, it } from "vitest";
import { runReviewHarnessIdBenchmark, type IdBenchmarkOperations } from "./reviewHarnessIdBenchmark";

function fixture() {
    let elapsed = 0;
    let derivations = 0;
    const chunkCounts = [0, 0];
    const documentCounts = [0, 0];
    const chunkSizes = new Set<number>();
    const operations: IdBenchmarkOperations = {
        deriveKey: () => {
            derivations++;
            elapsed += 42;
            return Promise.resolve("private-derived-key");
        },
        chunkId: (piece, independent) => {
            chunkCounts[independent ? 1 : 0]++;
            chunkSizes.add(piece.length);
            elapsed += independent ? 2 : 1;
            return Promise.resolve("private-chunk-id");
        },
        documentId: (_path, independent) => {
            documentCounts[independent ? 1 : 0]++;
            elapsed += independent ? 4 : 3;
            return Promise.resolve("private-document-id");
        },
    };
    return {
        operations,
        now: () => elapsed,
        yieldControl: () => {
            elapsed += 100;
            return Promise.resolve();
        },
        counts: () => ({ derivations, chunkCounts, documentCounts, chunkSizes: [...chunkSizes] }),
    };
}

describe("Review Harness ID measurements", () => {
    it("reports totals and per-ID timings separately, excluding warm-up and cooperative pauses", async () => {
        const f = fixture();
        const result = await runReviewHarnessIdBenchmark(f.operations, { now: f.now }, f.yieldControl);
        const report = result.observations.join("\n");

        expect(result.status).toBe("passed");
        expect(report).toContain("1000 IDs total median=1000.00 ms; range=1000.00–1000.00 ms; per ID=1.0000 ms");
        expect(report).toContain("1000 IDs total median=2000.00 ms; range=2000.00–2000.00 ms; per ID=2.0000 ms");
        expect(report).toContain("Obfuscated document IDs, legacy: 1000 IDs total median=3000.00 ms");
        expect(report).toContain("Obfuscated document IDs, independent: 1000 IDs total median=4000.00 ms");
        expect(report).toContain("ID key derivation at save time: median=42.00 ms");
        expect(report).toContain("JavaScript heap: unavailable on this device.");
        expect(report).not.toContain("private-");
        expect(f.counts()).toEqual({
            derivations: 3,
            chunkCounts: [9288, 9288],
            documentCounts: [3096, 3096],
            chunkSizes: [256, 4096, 32768],
        });
    });

    it("labels the highest sampled heap separately from total app RAM and allows a lower final sample", async () => {
        const f = fixture();
        let reads = 0;
        const clock = {
            now: f.now,
            get memory() {
                return { usedJSHeapSize: (reads++ === 0 ? 2 : reads === 2 ? 5 : 1) * 1048576 };
            },
        };
        const result = await runReviewHarnessIdBenchmark(f.operations, clock, f.yieldControl);

        expect(result.observations).toContain(
            "JavaScript heap: before=2.00 MiB; highest sampled=5.00 MiB; after=1.00 MiB."
        );
        expect(result.observations.join("\n")).toContain("neither total app RAM nor a true peak");
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, "throws"])(
        "keeps timings usable when the heap API returns %s",
        async (value) => {
            const f = fixture();
            const result = await runReviewHarnessIdBenchmark(
                f.operations,
                {
                    now: f.now,
                    get memory() {
                        if (value === "throws") throw new Error("Heap API unavailable");
                        return { usedJSHeapSize: value as number };
                    },
                },
                f.yieldControl
            );

            expect(result.status).toBe("passed");
            expect(result.observations).toContain("JavaScript heap: unavailable on this device.");
            expect(result.observations.join("\n")).not.toMatch(/NaN|Infinity|private-/u);
        }
    );
});
