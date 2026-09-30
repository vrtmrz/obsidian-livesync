import type { ReviewHarnessScenarioResult } from "./reviewHarnessTypes";

export interface IdBenchmarkOperations {
    deriveKey(): Promise<unknown>;
    chunkId(piece: string, independent: boolean): Promise<string>;
    documentId(path: string, independent: boolean): Promise<string>;
}

type BenchmarkPerformance = Pick<Performance, "now"> & {
    readonly memory?: { readonly usedJSHeapSize: number };
};

const ID_COUNT = 1000;
const SAMPLES = 3;
const BATCH_SIZE = 100;
const WARMUP_COUNT = 32;

function readHeap(clock: BenchmarkPerformance): number | undefined {
    try {
        const bytes = clock.memory?.usedJSHeapSize;
        return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
    } catch {
        return undefined;
    }
}

function summary(samples: readonly number[]): string {
    const sorted = [...samples].sort((a, b) => a - b);
    return `median=${sorted[1].toFixed(2)} ms; range=${sorted[0].toFixed(2)}–${sorted[2].toFixed(2)} ms`;
}

export async function runReviewHarnessIdBenchmark(
    operations: IdBenchmarkOperations,
    clock: BenchmarkPerformance = performance,
    yieldControl: () => Promise<void> = () => new Promise((resolve) => window.setTimeout(resolve, 0))
): Promise<ReviewHarnessScenarioResult> {
    const before = readHeap(clock);
    let highest = before;
    const sampleHeap = () => {
        const value = readHeap(clock);
        if (value !== undefined) highest = Math.max(highest ?? value, value);
        return value;
    };
    const observations = [
        "Fixed synthetic inputs; 3 samples, alternating legacy/independent order; 32 warm-up IDs per sample. Legacy Chunk algorithm: xxhash64.",
        "Compute timings include input construction and awaited ID generation. Initialisation, warm-up, and pauses between batches are excluded. This does not measure a Rebuild or remote transfer.",
    ];
    const derivationSamples: number[] = [];
    for (let sample = 0; sample < SAMPLES; sample++) {
        await yieldControl();
        const started = clock.now();
        await operations.deriveKey();
        derivationSamples.push(clock.now() - started);
        sampleHeap();
    }
    observations.push(`ID key derivation at save time: ${summary(derivationSamples)} per derivation.`);

    const cases = [
        ...[256, 4096, 32768].map((bytes) => {
            const prefix = "r".repeat(bytes - 8);
            return {
                label: `Chunk IDs, ${bytes} B`,
                run: (i: number, independent: boolean) =>
                    operations.chunkId(prefix + i.toString(36).padStart(8, "0"), independent),
            };
        }),
        {
            label: "Obfuscated document IDs",
            run: (i: number, independent: boolean) => operations.documentId(`benchmark/path-${i}.md`, independent),
        },
    ];
    for (const scenario of cases) {
        const samples: [number[], number[]] = [[], []];
        for (let sample = 0; sample < SAMPLES; sample++) {
            for (const independent of sample % 2 === 0 ? [false, true] : [true, false]) {
                for (let i = 0; i < WARMUP_COUNT; i++) await scenario.run(i, independent);
                let elapsed = 0;
                for (let batch = 0; batch < ID_COUNT; batch += BATCH_SIZE) {
                    await yieldControl();
                    const started = clock.now();
                    for (let i = batch; i < batch + BATCH_SIZE; i++) await scenario.run(i, independent);
                    elapsed += clock.now() - started;
                    sampleHeap();
                }
                samples[independent ? 1 : 0].push(elapsed);
            }
        }
        for (const [index, values] of samples.entries()) {
            const median = [...values].sort((a, b) => a - b)[1];
            observations.push(
                `${scenario.label}, ${index === 0 ? "legacy" : "independent"}: ${ID_COUNT} IDs total ${summary(values)}; per ID=${(median / ID_COUNT).toFixed(4)} ms.`
            );
        }
    }
    const after = sampleHeap();
    if (highest === undefined) {
        observations.push("JavaScript heap: unavailable on this device.");
    } else {
        const mib = (bytes: number | undefined) =>
            bytes === undefined ? "unavailable" : `${(bytes / 1048576).toFixed(2)} MiB`;
        observations.push(
            `JavaScript heap: before=${mib(before)}; highest sampled=${mib(highest)}; after=${mib(after)}.`
        );
    }
    observations.push(
        "Heap samples are approximate, may include other Obsidian work, and are affected by garbage collection. They are neither total app RAM nor a true peak."
    );
    return { status: "passed", detail: "ID generation measurements completed.", observations };
}
