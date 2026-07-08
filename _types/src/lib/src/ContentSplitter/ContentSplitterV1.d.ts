// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ContentSplitterOptions, SplitOptions } from "./ContentSplitter";
import { ContentSplitterBase } from "./ContentSplitterBase";
/**
 * Legacy content splitter for version 1.
 */
export declare class ContentSplitterV1 extends ContentSplitterBase {
    static isAvailableFor(setting: ContentSplitterOptions): boolean;
    processSplit(options: SplitOptions): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
}
