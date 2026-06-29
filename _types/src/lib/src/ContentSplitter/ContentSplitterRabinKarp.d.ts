// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ContentSplitterOptions, SplitOptions } from "./ContentSplitter.ts";
import { ContentSplitterBase } from "./ContentSplitterBase.ts";
/**
 * Rabin-Karp content splitter for efficient chunking
 */
export declare class ContentSplitterRabinKarp extends ContentSplitterBase {
    static isAvailableFor(setting: ContentSplitterOptions): boolean;
    processSplit(options: SplitOptions): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
}
