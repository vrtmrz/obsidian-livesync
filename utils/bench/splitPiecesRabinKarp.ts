import { glob } from "glob";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { isPlainText, shouldSplitAsPlainText } from "../../src/lib/src/string_and_binary/path";
import { splitPiecesRabinKarp } from "../../src/lib/src/string_and_binary/chunks";
import {
    PREFERRED_BASE,
    PREFERRED_JOURNAL_SYNC,
    PREFERRED_SETTING_CLOUDANT,
    PREFERRED_SETTING_SELF_HOSTED,
} from "../../src/lib/src/common/models/setting.const.preferred";
import { type ObsidianLiveSyncSettings, DEFAULT_SETTINGS, MAX_DOC_SIZE_BIN } from "../../src/lib/src/common/types";

async function blobFromString(content: string): Promise<Blob> {
    return new Blob([content], { type: "text/plain" });
}

const preferred = PREFERRED_BASE;
const preferredJournal = PREFERRED_JOURNAL_SYNC;
const preferredCouchDB = PREFERRED_SETTING_SELF_HOSTED;
const preferredIBM = PREFERRED_SETTING_CLOUDANT;

function computeChunkSize(overlay: Partial<ObsidianLiveSyncSettings>) {
    const settings = { ...DEFAULT_SETTINGS, ...overlay };
    const maxChunkSize = Math.floor(MAX_DOC_SIZE_BIN * ((settings.customChunkSize || 0) * 1 + 1));
    const pieceSize = maxChunkSize;

    const minimumChunkSize = settings.minimumChunkSize;
    return { pieceSize, minimumChunkSize };
}

async function testSplit(
    splitPiecesRabinKarpFn: typeof splitPiecesRabinKarp,
    content: Blob,
    settingsOverlay: Partial<ObsidianLiveSyncSettings>
) {
    const { pieceSize, minimumChunkSize } = computeChunkSize(settingsOverlay);
    const isPlain = content.type === "text/plain";
    const chunkGenerator = await splitPiecesRabinKarpFn(content, pieceSize, isPlain, minimumChunkSize);
    const chunks = [] as string[];
    for await (const chunk of chunkGenerator()) {
        chunks.push(chunk);
    }
    // if there are few chunks, calculate average chunk size except the last chunk which can be smaller due to the way the algorithm works, especially for small files.
    const averageChunkSize =
        chunks.length > 1
            ? chunks.slice(0, -1).reduce((acc, chunk) => acc + chunk.length, 0) / (chunks.length - 1)
            : chunks.reduce((acc, chunk) => acc + chunk.length, 0) / chunks.length;
    const lastChunk = chunks[chunks.length - 1];
    // compute minimum chunk size if the last chunk is not the smallest.
    const nonLastChunkSizes = chunks.slice(0, -1).map((c) => c.length);
    const minChunkSize = nonLastChunkSizes.length > 0 ? Math.min(...nonLastChunkSizes) : lastChunk.length;
    const result = {
        isPlain,
        originalSize: content.size,
        chunkCount: chunks.length,
        totalLength: chunks.reduce((acc, chunk) => acc + chunk.length, 0),
        averageChunkSize: averageChunkSize,
        maxChunkSize: Math.max(...chunks.map((c) => c.length)),
        minChunkSize: minChunkSize,
        uniqueChunks: new Set(chunks).size,
        chunks: chunks,
    };
    return result;
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
async function loadFileAsBlob(filePath: string): Promise<Blob> {
    if (shouldSplitAsPlainText(filePath)) {
        const content = await fs.readFile(filePath, "utf-8");
        return blobFromString(content);
    } else {
        const buffer = await fs.readFile(filePath);
        return new Blob([buffer]);
    }
}
const testProfiles = [
    { name: "CouchDB", settings: preferredCouchDB },
    { name: "IBM Cloudant", settings: preferredIBM },
    { name: "Journal Sync", settings: preferredJournal },
    // { name: "Base", settings: preferred },
];
function modifyBlob(blob: Blob, position: number, insertText: string): Blob {
    const before = blob.slice(0, position);
    const after = blob.slice(position);
    const insert = new Blob([insertText], { type: blob.type });
    return new Blob([before, insert, after], { type: blob.type });
}
async function main() {
    const results = [] as string[][];
    console.log("directory:", __dirname);
    const findPath = resolve(__dirname, "../../");
    console.warn("CWD:", findPath);
    let testFiles = await glob("**/*.*", {
        cwd: findPath,
        maxDepth: 20,
        ignore: ["**/node_modules/**", "**/.obsidian/**", "**/dist/**", "**/build/**", "**/out/**"],
    });
    testFiles = testFiles.filter((file) => {
        const ext = file.split(".").pop()?.toLowerCase() || "";
        return ["md", "txt", "json", "csv", "png"].includes(ext);
    });
    const header = [
        "Profile",
        "Implementation",
        "Edition",
        "File",
        "Mode",
        "Original Size (bytes)",
        "Chunk Count",
        "Average Chunk Size",
        "Max Chunk Size",
        "Min Chunk Size",
        "Unique Chunks",
        "Shared Chunks",
        "Savings",
        "Newly added (count)",
        "Newly consumed (bytes)",
    ];
    for (const profile of testProfiles) {
        console.log(`Testing profile: ${profile.name}`);
        for (const fn of [splitPiecesRabinKarp]) {
            const funcProfile = fn !== splitPiecesRabinKarp ? "Old" : "New";
            console.log(`Testing function: ${funcProfile}`);
            for (const file of testFiles) {
                const filePath = resolve(findPath, file);
                const isPlain = shouldSplitAsPlainText(filePath);
                const content = await loadFileAsBlob(filePath);
                console.log(`Testing file: ${file} (size: ${content.size} bytes)`);
                const result = await testSplit(fn, content, profile.settings);
                const chunkSizes = result.chunks.map((c) => c.length);
                const savings = result.originalSize - chunkSizes.reduce((acc, size) => acc + size, 0);
                // console.log(`Result for ${file}:`, result);
                results.push([
                    `${profile.name}`,
                    funcProfile,
                    "original",
                    file,
                    isPlain ? "plain" : "binary",
                    content.size.toString(),
                    result.chunkCount.toString(),
                    result.averageChunkSize.toFixed(2),
                    result.maxChunkSize.toString(),
                    result.minChunkSize.toString(),
                    result.uniqueChunks.toString(),
                    "",
                    savings.toString(),
                    "",
                    "",
                ]);
                // add editions (inserting "*") to content  on  head, 5%, middle, 95%, tail to see if it affects the chunking
                const editions = [
                    { name: "head", content: modifyBlob(content, 0, "*") },
                    { name: "5%", content: modifyBlob(content, Math.floor(content.size * 0.05), "*") },
                    { name: "middle", content: modifyBlob(content, Math.floor(content.size * 0.5), "*") },
                    { name: "95%", content: modifyBlob(content, Math.floor(content.size * 0.95), "*") },
                    { name: "tail", content: modifyBlob(content, content.size, "*") },
                ];
                const baseChunks = result.chunks;
                for (const edition of editions) {
                    console.log(`Testing edition: ${edition.name}`);
                    const editionResult = await testSplit(fn, edition.content, profile.settings);
                    const sharedChunks = editionResult.chunks.filter((chunk) => baseChunks.includes(chunk)).length;
                    const newChunks = editionResult.chunks.filter((chunk) => !baseChunks.includes(chunk));
                    const editionResultChunkLength = editionResult.chunks.map((c) => c.length);
                    // console.log(`Result for edition ${edition.name} of ${file}:`, editionResult);
                    const editionSavings =
                        editionResult.originalSize - editionResultChunkLength.reduce((acc, size) => acc + size, 0);
                    // newly added chunks size :
                    const newChunksSize = newChunks.reduce((acc, chunk) => acc + chunk.length, 0);
                    results.push([
                        `${profile.name}`,
                        funcProfile,
                        `${edition.name}`,
                        file,
                        isPlain ? "plain" : "binary",
                        edition.content.size.toString(),
                        editionResult.chunkCount.toString(),
                        editionResult.averageChunkSize.toFixed(2),
                        editionResult.maxChunkSize.toString(),
                        editionResult.minChunkSize.toString(),
                        editionResult.uniqueChunks.toString(),
                        sharedChunks.toString(),
                        editionSavings.toString(),
                        newChunks.length.toString(),
                        newChunksSize.toString(),
                    ]);
                }
            }
        }
    }

    results.unshift(header);
    await fs.writeFile(resolve(__dirname, "splitResults.csv"), results.map((r) => r.join(",")).join("\n"));
}
main();
