import type { UXFileInfoStub, UXFolderInfo } from "@lib/common/models/fileaccess.type";
/**
 * Conversion adapter interface
 * Converts between native file system types and universal types
 */
export interface IConversionAdapter<TNativeFile = any, TNativeFolder = any> {
    /**
     * Convert a native file object to a universal file info stub
     */
    nativeFileToUXFileInfoStub(file: TNativeFile): UXFileInfoStub;
    /**
     * Convert a native folder object to a universal folder info
     */
    nativeFolderToUXFolder(folder: TNativeFolder): UXFolderInfo;
}
