// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
export declare function splitPiecesTextV2(dataSrc: string | string[], pieceSize: number, minimumChunkSize: number): () => Generator<string>;
export declare function binaryTextSplit(data: string, pieceSize: number, minimumChunkSize: number): () => Generator<string>;
export declare function splitPiecesText(dataSrc: string | string[], pieceSize: number, plainSplit: boolean, minimumChunkSize: number, useSegmenter: boolean): () => Generator<string>;
export declare function splitPiecesTextV1(dataSrc: string | string[], pieceSize: number, plainSplit: boolean, minimumChunkSize: number): () => Generator<string>;
export declare function collectGenAll(strGen: AsyncGenerator<string, unknown, unknown> | Generator<string>): Promise<string[]>;
export declare function concatGeneratedAll(strGen: AsyncGenerator<string, unknown, unknown> | Generator<string>): Promise<string>;
export declare function splitPieces2V2(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): Promise<(() => Generator<string>) | (() => AsyncGenerator<string>)>;
export declare function splitPieces2(dataSrc: Blob, pieceSize: number, plainSplit: boolean, minimumChunkSize: number, filename?: string, useSegmenter?: boolean): Promise<(() => Generator<string>) | (() => AsyncGenerator<string>)>;
export declare function splitPiecesRabinKarp(dataSrc: Blob, absoluteMaxPieceSize: number, doPlainSplit: boolean, minimumChunkSize: number, _filename?: string, _useSegmenter?: boolean): Promise<() => AsyncGenerator<string, void, unknown>>;
export declare function splitPiecesRabinKarpOld(dataSrc: Blob, absoluteMaxPieceSize: number, doPlainSplit: boolean, minimumChunkSize: number, _filename?: string, _useSegmenter?: boolean): Promise<() => AsyncGenerator<string, void, unknown>>;
