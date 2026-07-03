// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import { type SavingEntry } from "@lib/common/types.ts";
import { type ContentSplitterOptions, type SplitOptions } from "./ContentSplitter.ts";
export declare abstract class ContentSplitterCore {
    /**
     * Options for the content splitter.
     * These settings include the chunk splitter version and other configurations.
     */
    options: ContentSplitterOptions;
    /**
     * Task for initialising the content splitter.
     * This ensures that the splitter is initialised before any operations are performed.
     */
    initialised: Promise<boolean> | undefined;
    /**
     * Constructor for the content splitter core.
     * @param params Content splitter options
     */
    constructor(params: ContentSplitterOptions);
    /**
     * Initialise the content splitter with the provided options.
     * @param options Content splitter options
     */
    abstract initialise(options: ContentSplitterOptions): Promise<boolean>;
    /**
     * Split the content of the loaded entry into chunks.
     * @param entry The loaded entry to be split into chunks
     */
    abstract splitContent(entry: SavingEntry): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
}
export declare abstract class ContentSplitterBase extends ContentSplitterCore {
    initialise(_options: ContentSplitterOptions): Promise<boolean>;
    /**
     * Check whether the content splitter is available for the given settings.
     * @param setting Content splitter options
     * @returns True if the content splitter is available; false otherwise
     */
    static isAvailableFor(setting: ContentSplitterOptions): boolean;
    /**
     * Process the content and split it into chunks.
     * @param options Blob content to be split into chunks
     */
    abstract processSplit(options: SplitOptions): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
    getParamsFor(entry: SavingEntry): SplitOptions;
    /**
     * Split the content of the loaded entry into chunks.
     * This method waits for the initialisation task to complete before proceeding.
     * @param entry The loaded entry to be split into chunks
     * @returns A generator that yields the split chunks
     */
    splitContent(entry: SavingEntry): Promise<AsyncGenerator<string, void, unknown> | Generator<string, void, unknown>>;
}
