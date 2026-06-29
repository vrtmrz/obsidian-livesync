// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
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
    pbkdf2Salt: Uint8Array;
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
export type ResultPayloadBase = {
    key: number;
};
export type ResultPayloadWithResult = ResultPayloadBase & {
    result: string;
};
export type ResultPayloadWithError = ResultPayloadBase & {
    error: unknown;
};
export type ResultPayload = ResultPayloadWithResult | ResultPayloadWithError;
export type ResultPayloadWithSeqBase = ResultPayload & {
    seq: number;
};
export type ResultPayloadPiece = ResultPayloadWithSeqBase & {
    result: string | END_OF_DATA;
};
export type ResultPayloadWithSeq = ResultPayloadPiece | ResultPayloadWithError;
