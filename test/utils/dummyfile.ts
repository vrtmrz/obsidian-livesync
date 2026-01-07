import { DEFAULT_SETTINGS } from "@/lib/src/common/types.ts";
import { readFile } from "../utils/fileapi.vite.ts";
let charset = "";
export async function init() {
    console.log("Initializing dummyfile utils...");

    charset = (await readFile("test/utils/testcharvariants.txt")).toString();
    console.log(`Loaded charset of length ${charset.length}`);
    console.log(charset);
}
export const DummyFileSourceInisialised = init();
function* indexer(range: number = 1000, seed: number = 0): Generator<number, number, number> {
    let t = seed | 0;
    while (true) {
        t = (t + 0x6d2b79f5) | 0;
        let z = t;
        z = Math.imul(z ^ (z >>> 15), z | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        const float = ((z ^ (z >>> 14)) >>> 0) / 4294967296;
        yield Math.floor(float * range);
    }
}

export function* generateFile(size: number): Generator<string> {
    const chunkSourceStr = charset;
    const chunkStore = [...chunkSourceStr]; // To support indexing avoiding multi-byte issues
    const bufSize = 1024;
    let buf = "";
    let generated = 0;
    const indexGen = indexer(chunkStore.length);
    while (generated < size) {
        const f = indexGen.next().value;
        buf += chunkStore[f];
        generated += 1;
        if (buf.length >= bufSize) {
            yield buf;
            buf = "";
        }
    }
    if (buf.length > 0) {
        yield buf;
    }
}
export function* generateBinaryFile(size: number): Generator<Uint8Array<ArrayBuffer>> {
    let generated = 0;
    const pattern = Array.from({ length: 256 }, (_, i) => i);
    const indexGen = indexer(pattern.length);
    const bufSize = 1024;
    const buf = new Uint8Array(bufSize);
    let bufIdx = 0;
    while (generated < size) {
        const f = indexGen.next().value;
        buf[bufIdx] = pattern[f];
        bufIdx += 1;
        generated += 1;
        if (bufIdx >= bufSize) {
            yield buf;
            bufIdx = 0;
        }
    }
    if (bufIdx > 0) {
        yield buf.subarray(0, bufIdx);
    }
}

// File size for markdown test files (10B to 1MB, roughly logarithmic scale)
export const FILE_SIZE_MD = [10, 100, 1000, 10000, 100000, 1000000];
// File size for test files (10B to 40MB, roughly logarithmic scale)
export const FILE_SIZE_BINS = [
    10,
    100,
    1000,
    50000,
    100000,
    5000000,
    DEFAULT_SETTINGS.syncMaxSizeInMB * 1024 * 1024 + 1,
];
