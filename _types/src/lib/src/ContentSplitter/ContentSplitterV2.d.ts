// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { ContentSplitterOptions, SplitOptions } from "./ContentSplitter.ts";
import { ContentSplitterBase } from "./ContentSplitterBase.ts";
/**
 * Content splitter for version 2, which supports segmenter-based splitting.
 */
export declare class ContentSplitterV2 extends ContentSplitterBase {
    static isAvailableFor(setting: ContentSplitterOptions): boolean;
    processSplit(options: SplitOptions): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
}
