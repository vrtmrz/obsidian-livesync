import { join } from "@std/path";
import type { DatasetEntry, DatasetKind } from "./dataset.ts";

export type CompressionDatasetEntry = DatasetEntry & {
    source: string;
};

export type CompressionDataset = {
    entries: CompressionDatasetEntry[];
    totalFiles: number;
    totalBytes: number;
    bytesByKind: Record<DatasetKind, number>;
    filesByKind: Record<DatasetKind, number>;
    jpegGenerator: string;
};

export type JpegEncoder = (inputPpm: string, outputJpeg: string) => Promise<string>;

const ALL_KINDS: DatasetKind[] = ["md", "jpg", "png", "json", "ts", "gz", "bin"];

const REPOSITORY_ROOT = join(import.meta.dirname!, "..", "..", "..", "..", "..");

function fnv1a32(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i) & 0xff;
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function createXorshift32(seed: number): () => number {
    let state = seed || 0x9e3779b9;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
    };
}

function createSyntheticPpm(width: number, height: number, seed: string, textured: boolean): Uint8Array {
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
    const pixels = new Uint8Array(width * height * 3);
    const nextRandom = createXorshift32(fnv1a32(seed));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const offset = (y * width + x) * 3;
            const noise = textured ? (nextRandom() & 0x3f) - 32 : 0;
            pixels[offset] = Math.max(0, Math.min(255, Math.floor((x * 255) / (width - 1)) + noise));
            pixels[offset + 1] = Math.max(0, Math.min(255, Math.floor((y * 255) / (height - 1)) + noise));
            pixels[offset + 2] = Math.max(0, Math.min(255, Math.floor(((x + y) * 255) / (width + height - 2)) - noise));
        }
    }
    const result = new Uint8Array(header.length + pixels.length);
    result.set(header);
    result.set(pixels, header.length);
    return result;
}

async function gzip(input: Uint8Array): Promise<Uint8Array> {
    const copied = new Uint8Array(input.byteLength);
    copied.set(input);
    const stream = new Blob([copied.buffer]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeJpegWithCjpeg(inputPpm: string, outputJpeg: string): Promise<string> {
    const command = new Deno.Command("cjpeg", {
        args: ["-quality", "85", "-optimize", "-outfile", outputJpeg, inputPpm],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
    });
    let result: Deno.CommandOutput;
    try {
        result = await command.output();
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            throw new Error(
                "cjpeg is required for the compression benchmark. Use the Compose runner or install libjpeg tools."
            );
        }
        throw error;
    }
    if (!result.success) {
        throw new Error(`cjpeg failed: ${new TextDecoder().decode(result.stderr)}`);
    }
    return "cjpeg quality=85, optimise=true, synthetic PPM 640x480";
}

async function writeRandomBinary(path: string, size: number, seed: string): Promise<void> {
    const bytes = new Uint8Array(size);
    const nextRandom = createXorshift32(fnv1a32(seed));
    for (let index = 0; index < bytes.length; index++) {
        bytes[index] = nextRandom() & 0xff;
    }
    await Deno.writeFile(path, bytes);
}

export async function createCompressionBenchmarkDataset(options: {
    rootDir: string;
    datasetDirName?: string;
    repositoryRoot?: string;
    seed?: string;
    jpegEncoder?: JpegEncoder;
}): Promise<CompressionDataset> {
    const datasetDirName = options.datasetDirName ?? "compression-benchmark";
    const repositoryRoot = options.repositoryRoot ?? REPOSITORY_ROOT;
    const seed = options.seed ?? "livesync-compression-benchmark";
    const jpegEncoder = options.jpegEncoder ?? encodeJpegWithCjpeg;
    const datasetRoot = join(options.rootDir, datasetDirName);
    const entries: CompressionDatasetEntry[] = [];
    let jpegGenerator = "";

    for (const kind of ALL_KINDS) {
        await Deno.mkdir(join(datasetRoot, kind), { recursive: true });
    }

    const addFile = async (kind: DatasetKind, absolutePath: string, source: string) => {
        const relativePath = absolutePath
            .slice(options.rootDir.length + 1)
            .split("\\")
            .join("/");
        const size = (await Deno.stat(absolutePath)).size;
        entries.push({ kind, relativePath, absolutePath, size, source });
    };

    const copyRepositoryFile = async (kind: DatasetKind, sourcePath: string, targetName: string) => {
        const destination = join(datasetRoot, kind, targetName);
        await Deno.copyFile(join(repositoryRoot, sourcePath), destination);
        await addFile(kind, destination, sourcePath);
    };

    await copyRepositoryFile("md", "docs/settings.md", "settings.md");
    await copyRepositoryFile("md", "docs/quick_setup.md", "quick-setup.md");
    await copyRepositoryFile("md", "updates.md", "updates.md");
    await copyRepositoryFile("png", "instruction_images/cloudant_1.png", "cloudant-1.png");
    await copyRepositoryFile(
        "png",
        "images/quick-setup/guide-quick-setup-first-setup-uri.png",
        "quick-setup-first-setup-uri.png"
    );
    await copyRepositoryFile("json", "package.json", "package.json");
    await copyRepositoryFile("json", "manifest.json", "manifest.json");
    await copyRepositoryFile("ts", "src/modules/core/ModuleReplicator.ts", "ModuleReplicator.ts");
    await copyRepositoryFile("ts", "src/modules/core/ReplicateResultProcessor.ts", "ReplicateResultProcessor.ts");

    const markdownBytes = await Deno.readFile(join(repositoryRoot, "docs/settings.md"));
    const gzipPath = join(datasetRoot, "gz", "settings.md.gz");
    await Deno.writeFile(gzipPath, await gzip(markdownBytes));
    await addFile("gz", gzipPath, "generated gzip of docs/settings.md");

    const randomPath = join(datasetRoot, "bin", "deterministic-random.bin");
    await writeRandomBinary(randomPath, 256 * 1024, seed);
    await addFile("bin", randomPath, `deterministic xorshift32 seed=${seed}`);

    for (const [name, textured] of [
        ["smooth-gradient.jpg", false],
        ["textured-gradient.jpg", true],
    ] as const) {
        const ppmPath = await Deno.makeTempFile({ dir: options.rootDir, prefix: "compression-jpeg-", suffix: ".ppm" });
        const jpegPath = join(datasetRoot, "jpg", name);
        try {
            await Deno.writeFile(ppmPath, createSyntheticPpm(640, 480, `${seed}-${name}`, textured));
            jpegGenerator = await jpegEncoder(ppmPath, jpegPath);
        } finally {
            await Deno.remove(ppmPath).catch(() => {});
        }
        await addFile("jpg", jpegPath, `${jpegGenerator}; ${textured ? "textured" : "smooth"}`);
    }

    const bytesByKind = Object.fromEntries(ALL_KINDS.map((kind) => [kind, 0])) as Record<DatasetKind, number>;
    const filesByKind = Object.fromEntries(ALL_KINDS.map((kind) => [kind, 0])) as Record<DatasetKind, number>;
    for (const entry of entries) {
        bytesByKind[entry.kind] += entry.size;
        filesByKind[entry.kind] += 1;
    }

    return {
        entries,
        totalFiles: entries.length,
        totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
        bytesByKind,
        filesByKind,
        jpegGenerator,
    };
}
