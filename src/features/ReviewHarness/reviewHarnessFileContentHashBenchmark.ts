import type { ReviewHarnessScenarioResult } from "./reviewHarnessTypes";

export const REVIEW_HARNESS_FILE_CONTENT_HASH_INPUTS = [
    { label: "4 KiB", bytes: 4 * 1024 },
    { label: "64 KiB", bytes: 64 * 1024 },
    { label: "1 MiB", bytes: 1024 * 1024 },
    { label: "50 MiB", bytes: 50 * 1024 * 1024 },
] as const;

const CONTENT_BLOCK_BYTES = 64 * 1024;
const SAMPLE_COUNT = 3;

export interface FileContentHashBenchmarkOperations {
    readonly xxHashInitialisationMs: number;
    createInput(bytes: number): Blob;
    sha256(content: Blob): Promise<`sha256:${string}`>;
    xxHash64(content: Blob): Promise<bigint>;
}

type BenchmarkPerformance = Pick<Performance, "now"> & {
    readonly memory?: { readonly usedJSHeapSize: number };
};

type HashAlgorithm = "SHA-256" | "xxHash64";

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
    const middle = sorted[Math.floor(sorted.length / 2)];
    return `median=${middle.toFixed(2)} ms; range=${sorted[0].toFixed(2)}–${sorted[sorted.length - 1].toFixed(2)} ms`;
}

function hashKey(hash: `sha256:${string}` | bigint): string {
    if (typeof hash === "bigint") return hash.toString(16);
    return hash;
}

export function createFixedFileContentHashInput(bytes: number): Blob {
    const block = new Uint8Array(CONTENT_BLOCK_BYTES);
    for (let index = 0; index < block.length; index++) block[index] = (index * 31 + 17) & 0xff;

    const parts: BlobPart[] = [];
    for (let remaining = bytes; remaining > 0; remaining -= CONTENT_BLOCK_BYTES) {
        parts.push(block.subarray(0, Math.min(remaining, CONTENT_BLOCK_BYTES)));
    }
    return new Blob(parts);
}

export async function runReviewHarnessFileContentHashBenchmark(
    operations: FileContentHashBenchmarkOperations,
    clock: BenchmarkPerformance = performance,
    yieldControl: () => Promise<void> = () => new Promise((resolve) => window.setTimeout(resolve, 0))
): Promise<ReviewHarnessScenarioResult> {
    if (!Number.isFinite(operations.xxHashInitialisationMs) || operations.xxHashInitialisationMs < 0) {
        throw new Error("The xxHash64 initialisation time is invalid.");
    }

    const before = readHeap(clock);
    let highest = before;
    const sampleHeap = () => {
        const value = readHeap(clock);
        if (value !== undefined) highest = Math.max(highest ?? value, value);
        return value;
    };

    const inputs: { readonly label: string; readonly bytes: number; readonly content: Blob }[] = [];
    for (const { label, bytes } of REVIEW_HARNESS_FILE_CONTENT_HASH_INPUTS) {
        await yieldControl();
        inputs.push({ label, bytes, content: operations.createInput(bytes) });
        sampleHeap();
    }

    const hash = (algorithm: HashAlgorithm, content: Blob) =>
        algorithm === "SHA-256" ? operations.sha256(content) : operations.xxHash64(content);
    const warmupTimes = new Map<HashAlgorithm, number>();
    const signatures = new Map<string, string>();
    const checkHash = (algorithm: HashAlgorithm, label: string, result: `sha256:${string}` | bigint): void => {
        const value = hashKey(result);
        const key = `${algorithm}:${label}`;
        const previous = signatures.get(key);
        if (previous !== undefined && previous !== value) {
            throw new Error(`The ${algorithm} result changed for fixed in-memory content.`);
        }
        signatures.set(key, value);
    };

    for (const algorithm of ["SHA-256", "xxHash64"] as const) {
        await yieldControl();
        const started = clock.now();
        const result = await hash(algorithm, inputs[0].content);
        const elapsed = clock.now() - started;
        checkHash(algorithm, inputs[0].label, result);
        warmupTimes.set(algorithm, elapsed);
        sampleHeap();
    }

    const observations = [
        "Fixed in-memory Blob inputs contain the same deterministic byte sequence at 4 KiB, 64 KiB, 1 MiB, and 50 MiB. Input construction is excluded from timings.",
        `xxHash64 engine initialisation: ${operations.xxHashInitialisationMs.toFixed(2)} ms; measured separately.`,
        `Warm-up on 4 KiB, one call per algorithm: SHA-256=${warmupTimes.get("SHA-256")!.toFixed(2)} ms; xxHash64=${warmupTimes.get("xxHash64")!.toFixed(2)} ms; excluded from samples.`,
        "Each algorithm has three samples per input. SHA-256 uses the Self-hosted LiveSync file content hash helper; xxHash64 timings include Blob.arrayBuffer() and h64Raw. Calls run serially, with alternating algorithm order and a UI yield between calls.",
    ];

    for (const input of inputs) {
        const samples: Record<HashAlgorithm, number[]> = { "SHA-256": [], xxHash64: [] };
        for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
            const order: readonly HashAlgorithm[] =
                sample % 2 === 0 ? ["SHA-256", "xxHash64"] : ["xxHash64", "SHA-256"];
            for (const algorithm of order) {
                await yieldControl();
                const started = clock.now();
                const result = await hash(algorithm, input.content);
                const elapsed = clock.now() - started;
                checkHash(algorithm, input.label, result);
                if (!Number.isFinite(elapsed) || elapsed < 0) {
                    throw new Error(`The ${algorithm} measurement returned an invalid duration.`);
                }
                samples[algorithm].push(elapsed);
                sampleHeap();
            }
        }
        for (const algorithm of ["SHA-256", "xxHash64"] as const) {
            observations.push(`${algorithm}, ${input.label}: ${summary(samples[algorithm])}.`);
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
    return { status: "passed", detail: "File content hash measurements completed.", observations };
}
