import type { FilePath, UXStat } from "@lib/common/types";

/**
 * FileSystem API file representation
 */
export type FSAPIFile = {
    path: FilePath;
    stat: UXStat;
    handle: FileSystemFileHandle;
};

/**
 * FileSystem API folder representation
 */
export type FSAPIFolder = {
    path: FilePath;
    isFolder: true;
    handle: FileSystemDirectoryHandle;
};

/**
 * FileSystem API stat type (compatible with UXStat)
 */
export type FSAPIStat = UXStat;
