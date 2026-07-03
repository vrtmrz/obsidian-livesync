// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { SavingEntry } from "@lib/common/types";
import type { ContentSplitterOptions } from "./ContentSplitter";
import { ContentSplitterCore, type ContentSplitterBase } from "./ContentSplitterBase";
/**
 * ContentSplitter class that manages the active content splitter based on the provided settings.
 */
export declare class ContentSplitter extends ContentSplitterCore {
    _activeSplitter: ContentSplitterBase;
    constructor(options: ContentSplitterOptions);
    initialise(options: ContentSplitterOptions): Promise<boolean>;
    splitContent(entry: SavingEntry): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
}
