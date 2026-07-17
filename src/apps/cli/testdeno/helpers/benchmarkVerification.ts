import type { DatasetEntry } from "./dataset.ts";

export type BenchmarkVerificationMode = "all" | "sample";

export type BenchmarkVerificationResult = {
    verificationMode: BenchmarkVerificationMode;
    verifiedFiles: number;
    verificationComplete: boolean;
    datasetDigestSha256: string;
};

function toHex(bytes: ArrayBuffer): string {
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    return toHex(await crypto.subtle.digest("SHA-256", input));
}

export function parseBenchmarkVerificationMode(
    raw: string | undefined,
    fallback: BenchmarkVerificationMode = "sample"
): BenchmarkVerificationMode {
    const value = raw?.trim().toLowerCase();
    if (!value) return fallback;
    if (value === "all" || value === "sample") return value;
    throw new Error(`BENCH_VERIFY_MODE must be 'all' or 'sample', got '${raw}'`);
}

export function selectVerificationEntries(entries: DatasetEntry[], mode: BenchmarkVerificationMode): DatasetEntry[] {
    if (mode === "all" || entries.length === 0) return [...entries];

    const md = entries.find((entry) => entry.kind === "md");
    const bin = entries.find((entry) => entry.kind === "bin");
    const middle = entries[Math.floor(entries.length / 2)];
    const last = entries[entries.length - 1];
    const selected = new Map<string, DatasetEntry>();
    for (const entry of [md, bin, middle, last]) {
        if (entry) selected.set(entry.relativePath, entry);
    }
    return [...selected.values()];
}

export async function computeDatasetDigestSha256(entries: DatasetEntry[]): Promise<string> {
    const manifest: string[] = [];
    for (const entry of entries) {
        const contentDigest = await sha256(await Deno.readFile(entry.absolutePath));
        manifest.push(`${entry.kind}\t${entry.relativePath}\t${entry.size}\t${contentDigest}`);
    }
    return await sha256(new TextEncoder().encode(manifest.join("\n")));
}

export async function verifyBenchmarkDataset(
    entries: DatasetEntry[],
    mode: BenchmarkVerificationMode,
    verifyEntry: (entry: DatasetEntry) => Promise<void>
): Promise<BenchmarkVerificationResult> {
    const selected = selectVerificationEntries(entries, mode);
    for (const entry of selected) {
        await verifyEntry(entry);
    }

    return {
        verificationMode: mode,
        verifiedFiles: selected.length,
        verificationComplete: selected.length === entries.length,
        datasetDigestSha256: await computeDatasetDigestSha256(entries),
    };
}
