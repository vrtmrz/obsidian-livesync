// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
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
export declare function encryptHKDFWorker(input: string, passphrase: string, pbkdf2Salt: Uint8Array): Promise<string>;
export declare function decryptHKDFWorker(input: string, passphrase: string, pbkdf2Salt: Uint8Array): Promise<string>;
export declare const tasks: Map<number, ProcessItem>;
/**
 * Remove a completed (or aborted) task from both the tasks map and its worker's taskKeys set.
 */
export declare function removeTask(key: number): void;
export declare function initialiseWorkerModule(): void;
export declare function startWorker(data: Omit<EncryptHKDFArguments, "key">): EncryptHKDFProcessItem;
export declare function startWorker(data: Omit<EncryptArguments, "key">): EncryptProcessItem;
export declare function startWorker(data: Omit<SplitArguments, "key">): SplitProcessItem;
export declare function terminateWorker(): void;
