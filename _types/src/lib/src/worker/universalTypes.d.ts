import type { PromiseWithResolvers } from "octagonal-wheels/promises";
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
    pbkdf2Salt: Uint8Array<ArrayBuffer>;
};
export type SplitArguments = {
    key: number;
    type: "split";
    dataSrc: Blob;
    pieceSize: number;
    plainSplit: boolean;
    minimumChunkSize: number;
    filename?: string;
    useSegmenter: boolean;
    splitVersion: 1 | 2 | 3;
};
export type SplitProcessItem = {
    key: number;
    type: SplitArguments["type"];
    finalize: () => void;
};
export type EncryptProcessItem = {
    key: number;
    task: PromiseWithResolvers<string>;
    type: EncryptArguments["type"];
    finalize: () => void;
};
export type EncryptHKDFProcessItem = {
    key: number;
    task: PromiseWithResolvers<string>;
    type: EncryptHKDFArguments["type"];
    finalize: () => void;
};
export type ProcessItem = SplitProcessItem | EncryptProcessItem | EncryptHKDFProcessItem;
export declare const END_OF_DATA: null;
export type END_OF_DATA = typeof END_OF_DATA;
