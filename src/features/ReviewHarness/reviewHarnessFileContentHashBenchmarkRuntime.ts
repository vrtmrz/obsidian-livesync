import { computeFileContentHash } from "@vrtmrz/livesync-commonlib/hashing";
import { xxhashNew } from "octagonal-wheels/hash/xxhash.js";
import {
    createFixedFileContentHashInput,
    type FileContentHashBenchmarkOperations,
} from "./reviewHarnessFileContentHashBenchmark";

type XxHash64Engine = {
    h64Raw(content: Uint8Array): unknown;
};

function isXxHashFactory(value: unknown): value is () => unknown {
    return typeof value === "function";
}

function isXxHash64Engine(value: unknown): value is XxHash64Engine {
    return typeof value === "object" && value !== null && "h64Raw" in value && typeof value.h64Raw === "function";
}

export async function createFileContentHashBenchmarkOperations(
    clock: Pick<Performance, "now"> = performance
): Promise<FileContentHashBenchmarkOperations> {
    const factory: unknown = xxhashNew;
    if (!isXxHashFactory(factory)) {
        throw new TypeError("The xxHash64 factory must be callable.");
    }
    const started = clock.now();
    const xxHash: unknown = await factory();
    const xxHashInitialisationMs = clock.now() - started;
    if (!isXxHash64Engine(xxHash)) {
        throw new TypeError("The xxHash64 engine must provide h64Raw.");
    }
    return {
        xxHashInitialisationMs,
        createInput: createFixedFileContentHashInput,
        sha256: (content) => computeFileContentHash(content),
        xxHash64: async (content) => {
            const hash = xxHash.h64Raw(new Uint8Array(await content.arrayBuffer()));
            if (typeof hash !== "bigint") {
                throw new TypeError("The xxHash64 result must be a bigint.");
            }
            return hash;
        },
    };
}
