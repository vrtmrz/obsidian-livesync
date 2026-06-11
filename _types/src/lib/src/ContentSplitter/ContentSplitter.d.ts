import type { FilePathWithPrefix } from "@lib/common/models/db.type";
import type { ISettingService } from "@lib/services/base/IService.ts";
/**
 * ContentSplitter interface for splitting content into chunks.
 */
export type SplitOptions = {
    blob: Blob;
    path: FilePathWithPrefix;
    pieceSize: number;
    plainSplit: boolean;
    minimumChunkSize: number;
    useWorker: boolean;
    useSegmenter: boolean;
};
/**
 * The maximum size, in bytes, of a document to be processed by the content splitter in the foreground.
 */
export declare const MAX_CHUNKS_SIZE_ON_UI = 1024;
/**
 * Options for the content splitter.
 */
export type ContentSplitterOptions = {
    settingService: ISettingService;
};
