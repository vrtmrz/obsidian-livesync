import type { EncryptArguments, EncryptHKDFArguments, EncryptHKDFProcessItem, EncryptProcessItem, ProcessItem, SplitArguments, SplitProcessItem } from "./universalTypes.ts";
export type WorkerInstance = {
    worker: Worker;
    processing: number;
    /** Keys of tasks currently dispatched to this worker instance. */
    taskKeys: Set<number>;
};
export declare function splitPieces2Worker(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): () => AsyncGenerator<string, void, unknown>;
export declare function splitPieces2WorkerV2(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): () => AsyncGenerator<string, void, unknown>;
export declare function splitPieces2WorkerRabinKarp(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): () => AsyncGenerator<string, void, unknown>;
export declare function encryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean): Promise<string>;
export declare function decryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean): Promise<string>;
export declare function encryptHKDFWorker(input: string, passphrase: string, pbkdf2Salt: Uint8Array<ArrayBuffer>): Promise<string>;
export declare function decryptHKDFWorker(input: string, passphrase: string, pbkdf2Salt: Uint8Array<ArrayBuffer>): Promise<string>;
export declare const tasks: Map<number, ProcessItem>;
/**
 * Remove a completed (or aborted) task from both the tasks map and its worker's taskKeys set.
 */
export declare function removeTask(key: number): void;
export declare const _internal: {
    abortSplitTasks: typeof abortSplitTasks;
    handleTaskSplit: typeof handleTaskSplit;
    handleTaskEncrypt: typeof handleTaskEncrypt;
};
export declare function initialiseWorkerModule(): void;
export declare function startWorker(data: Omit<EncryptHKDFArguments, "key">): EncryptHKDFProcessItem;
export declare function startWorker(data: Omit<EncryptArguments, "key">): EncryptProcessItem;
export declare function startWorker(data: Omit<SplitArguments, "key">): SplitProcessItem;
export declare function terminateWorker(): void;
/**
 * Offloads encryption to a web worker.
 * @param data The data to be encrypted.
 * @returns A promise that resolves with the encryption result.
 */
export declare function encryptionOnWorker(data: Omit<EncryptArguments, "key">): Promise<string>;
/**
 * Offloads HKDF encryption to a web worker.
 * @param data The data to be encrypted.
 * @returns A promise that resolves with the encryption result.
 */
export declare function encryptionHKDFOnWorker(data: Omit<EncryptHKDFArguments, "key">): Promise<string>;
/**
 * Handles the encryption callbacks
 * @param process The process item associated with the task.
 * @param data The data to be processed.
 */
export declare function handleTaskEncrypt(process: EncryptProcessItem | EncryptHKDFProcessItem, data: {
    key: number;
    result?: string;
    error?: unknown;
}): void;
/**
 * Splits data into pieces using a worker.
 * @param dataSrc The source data to be split.
 * @param pieceSize The size of each piece.
 * @param plainSplit Whether to use plain splitting.
 * @param minimumChunkSize The minimum size of each chunk.
 * @param filename The name of the file being processed.
 * @param splitVersion The version of the splitting algorithm to use.
 * @param useSegmenter Whether to use a segmenter (only works on splitVersion:2)
 * @returns A generator that yields the split pieces.
 */
export declare function _splitPieces2Worker(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename: string | undefined, splitVersion: 1 | 2 | 3, useSegmenter: boolean): () => AsyncGenerator<string, void, unknown>;
/**
 * Aborts all in-flight split tasks identified by the given keys.
 * Called when the background worker that owned these tasks has crashed, so the streams
 * will never receive any more data and must be torn down to unblock callers.
 * @param keys The task keys to abort.
 * @param error The error to report to each stream.
 */
export declare function abortSplitTasks(keys: number[], error: Error): void;
/**
 * Handles the splitting callback from the worker.
 * @param process the splitting process item
 * @param data the data received from the worker
 */
export declare function handleTaskSplit(process: SplitProcessItem, data: {
    key: number;
    seq?: number;
    result?: string | null;
    error?: unknown;
}): void;
