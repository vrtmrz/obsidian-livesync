// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { EncryptHKDFProcessItem, EncryptProcessItem, SplitProcessItem, ProcessItem } from "./universalTypes.ts";
export type SplitArguments = {
    key: number;
    type: "split";
    dataSrc: Blob;
    pieceSize: number;
    plainSplit: boolean;
    minimumChunkSize: number;
    filename?: string;
    useV2: boolean;
    useSegmenter: boolean;
};
export type EncryptArguments = {
    key: number;
    type: "encrypt" | "decrypt";
    input: string;
    passphrase: string;
    autoCalculateIterations: boolean;
};
export type EncryptHKDFArguments = {
    key: number;
    type: "encryptHKDF" | "decryptHKDF";
    input: string;
    passphrase: string;
    pbkdf2Salt: Uint8Array;
};
export declare function terminateWorker(): void;
export declare function splitPieces2Worker(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): Promise<(() => Generator<string>) | (() => AsyncGenerator<string>)>;
export declare function splitPieces2WorkerV2(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): Promise<(() => Generator<string>) | (() => AsyncGenerator<string>)>;
export declare function splitPieces2WorkerRabinKarp(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): () => AsyncGenerator<string, void, unknown>;
export declare function encryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean): Promise<string>;
export declare function decryptWorker(input: string, passphrase: string, autoCalculateIterations: boolean): Promise<string>;
export declare function encryptHKDFWorker(input: string, passphrase: string, pbkdf2Salt: Uint8Array): Promise<string>;
export declare function decryptHKDFWorker(input: string, passphrase: string, pbkdf2Salt: Uint8Array): Promise<string>;
export declare function startWorker(data: Omit<EncryptHKDFArguments, "key">): EncryptHKDFProcessItem;
export declare function startWorker(data: Omit<EncryptArguments, "key">): EncryptProcessItem;
export declare function startWorker(data: Omit<SplitArguments, "key">): SplitProcessItem;
export declare const tasks: Map<number, ProcessItem>;
export declare function initialiseWorkerModule(): void;
