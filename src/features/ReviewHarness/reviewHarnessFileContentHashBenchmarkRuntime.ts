import { computeFileContentHash } from "@vrtmrz/livesync-commonlib/hashing";
import { xxhashNew } from "octagonal-wheels/hash/xxhash.js";
import {
    createFixedFileContentHashInput,
    type FileContentHashBenchmarkOperations,
} from "./reviewHarnessFileContentHashBenchmark";

export async function createFileContentHashBenchmarkOperations(
    clock: Pick<Performance, "now"> = performance
): Promise<FileContentHashBenchmarkOperations> {
    const started = clock.now();
    const xxHash = await xxhashNew();
    const xxHashInitialisationMs = clock.now() - started;
    return {
        xxHashInitialisationMs,
        createInput: createFixedFileContentHashInput,
        sha256: (content) => computeFileContentHash(content),
        xxHash64: async (content) => xxHash.h64Raw(new Uint8Array(await content.arrayBuffer())),
    };
}
