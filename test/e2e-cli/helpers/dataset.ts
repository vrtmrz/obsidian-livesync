import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DeterministicDatasetConfig = {
    rootDir: string;
    datasetDirName: string;
    seed: string;
    mdCount: number;
    mdMinSizeBytes: number;
    mdMaxSizeBytes: number;
    binCount: number;
    binSizeBytes: number;
};

export type DatasetKind = "md" | "jpg" | "png" | "json" | "ts" | "gz" | "bin";

export type DatasetEntry = {
    kind: DatasetKind;
    relativePath: string;
    absolutePath: string;
    size: number;
};

export type DeterministicDataset = {
    rootDir: string;
    datasetDirName: string;
    seed: string;
    entries: DatasetEntry[];
    totalFiles: number;
    totalBytes: number;
    mdCount: number;
    binCount: number;
};

function fnv1a32(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i) & 0xff;
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function createXorshift32(seed: number): () => number {
    let state = seed >>> 0;
    if (state === 0) {
        state = 0x9e3779b9;
    }
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
    };
}

function createTextBytes(size: number, fileIndex: number, seed: string): Uint8Array {
    const template =
        `# Bench file ${fileIndex}\n` +
        `seed: ${seed}\n` +
        "lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\n";

    const templateBytes = new TextEncoder().encode(template);
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
        out[i] = templateBytes[i % templateBytes.length];
    }
    return out;
}

export async function createDeterministicDataset(config: DeterministicDatasetConfig): Promise<DeterministicDataset> {
    if (config.mdCount < 0 || config.binCount < 0) {
        throw new Error("mdCount and binCount must be non-negative");
    }
    if (config.mdMinSizeBytes <= 0 || config.mdMaxSizeBytes <= 0 || config.binSizeBytes <= 0) {
        throw new Error("all size values must be positive");
    }
    if (config.mdMinSizeBytes > config.mdMaxSizeBytes) {
        throw new Error("mdMinSizeBytes must be <= mdMaxSizeBytes");
    }

    const datasetRoot = join(config.rootDir, config.datasetDirName);
    const mdDir = join(datasetRoot, "md");
    const binDir = join(datasetRoot, "bin");
    await mkdir(mdDir, { recursive: true });
    await mkdir(binDir, { recursive: true });

    const nextRandom = createXorshift32(fnv1a32(config.seed));
    const mdRange = config.mdMaxSizeBytes - config.mdMinSizeBytes + 1;
    const entries: DatasetEntry[] = [];

    for (let index = 0; index < config.mdCount; index++) {
        const size = config.mdMinSizeBytes + (nextRandom() % mdRange);
        const relativePath = `${config.datasetDirName}/md/file-${String(index).padStart(4, "0")}.md`;
        const absolutePath = join(config.rootDir, ...relativePath.split("/"));
        const body = createTextBytes(size, index, config.seed);
        await writeFile(absolutePath, body);
        entries.push({ kind: "md", relativePath, absolutePath, size });
    }

    for (let index = 0; index < config.binCount; index++) {
        const size = config.binSizeBytes;
        const relativePath = `${config.datasetDirName}/bin/file-${String(index).padStart(4, "0")}.bin`;
        const absolutePath = join(config.rootDir, ...relativePath.split("/"));
        const body = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
            body[i] = nextRandom() & 0xff;
        }
        await writeFile(absolutePath, body);
        entries.push({ kind: "bin", relativePath, absolutePath, size });
    }

    const totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
    return {
        rootDir: config.rootDir,
        datasetDirName: config.datasetDirName,
        seed: config.seed,
        entries,
        totalFiles: entries.length,
        totalBytes,
        mdCount: config.mdCount,
        binCount: config.binCount,
    };
}
