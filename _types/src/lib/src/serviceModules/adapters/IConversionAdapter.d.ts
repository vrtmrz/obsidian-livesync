// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/types.ts";
/**
 * Conversion adapter interface
 * Converts between native file system types and universal types
 */
export interface IConversionAdapter<TNativeFile = any, TNativeFolder = any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /**
     * Convert a native file object to a universal file info stub
     */
    nativeFileToUXFileInfoStub(file: TNativeFile): UXFileInfoStub;
    /**
     * Convert a native folder object to a universal folder info
     */
    nativeFolderToUXFolder(folder: TNativeFolder): UXFolderInfo;
}
