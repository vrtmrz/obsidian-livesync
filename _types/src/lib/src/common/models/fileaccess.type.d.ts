import type { FilePath, FilePathWithPrefix } from "./db.type";
export interface UXStat {
    size: number;
    mtime: number;
    ctime: number;
    type: "file" | "folder";
}
/**
 * Represents the common base properties for any filesystem object stub.
 */
export interface UXFileSystemStubBase {
    name: string;
    path: FilePath | FilePathWithPrefix;
    deleted?: boolean;
    isInternal?: boolean;
}
/**
 * Represents a stub for a regular file.
 */
export interface UXFileInfoStub extends UXFileSystemStubBase {
    stat: UXStat;
    isFolder?: false;
}
/**
 * Represents a complete file containing its binary body.
 */
export interface UXFileInfo extends UXFileInfoStub {
    body: Blob;
}
export type UXAbstractInfoStub = UXFileInfoStub | UXFolderInfo;
/**
 * Represents a stub for an internal/hidden file.
 */
export interface UXInternalFileInfoStub extends UXFileSystemStubBase {
    isFolder?: false;
    isInternal: true;
    stat: undefined;
}
/**
 * Represents information about a folder.
 */
export interface UXFolderInfo extends UXFileSystemStubBase {
    isFolder: true;
    children: UXFileInfoStub[];
    parent: FilePath | FilePathWithPrefix | undefined;
}
export interface UXDataWriteOptions {
    /**
     * Time of creation, represented as a unix timestamp, in milliseconds.
     * Omit this if you want to keep the default behaviour.
     * @public
     * */
    ctime?: number;
    /**
     * Time of last modification, represented as a unix timestamp, in milliseconds.
     * Omit this if you want to keep the default behaviour.
     * @public
     * */
    mtime?: number;
}
export type CacheData = string | ArrayBuffer;
export type FileEventType = "CREATE" | "DELETE" | "CHANGED" | "INTERNAL";
export interface FileEventArgs {
    file: UXFileInfoStub | UXInternalFileInfoStub;
    cache?: CacheData;
    oldPath?: string;
    ctx?: unknown;
}
export interface FileEventItem {
    type: FileEventType;
    args: FileEventArgs;
    key: string;
    skipBatchWait?: boolean;
    cancelled?: boolean;
    batched?: boolean;
}
export interface FileWithFileStat extends Omit<UXStat, "type"> {
    path: FilePath;
}
export interface FileWithStatAsProp {
    path: FilePath;
    stat: Omit<UXStat, "type">;
}
