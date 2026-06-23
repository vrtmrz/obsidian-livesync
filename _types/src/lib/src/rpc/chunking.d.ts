// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: f20eb19
export declare function estimateBytes(text: string): number;
export declare function splitIntoChunks(payload: string, maxBytes: number): string[];
export declare class IncomingChunkBuffer {
    total: number;
    parts: Map<number, string>;
    constructor(total: number);
    add(index: number, payload: string): void;
    missingIndices(): number[];
    isComplete(): boolean;
    toPayload(): string;
}
