// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, FilePathWithPrefix } from "./db.type";
export type UXStat = {
    size: number;
    mtime: number;
    ctime: number;
    type: "file" | "folder";
};
export type UXFileInfoStub = {
    name: string;
    path: FilePath | FilePathWithPrefix;
    stat: UXStat;
    deleted?: boolean;
    isFolder?: false;
    isInternal?: boolean;
};
export type UXFileInfo = UXFileInfoStub & {
    body: Blob;
};
export type UXAbstractInfoStub = UXFileInfoStub | UXFolderInfo;
export type UXInternalFileInfoStub = {
    name: string;
    path: FilePath | FilePathWithPrefix;
    deleted?: boolean;
    isFolder?: false;
    isInternal: true;
    stat: undefined;
};
export type UXFolderInfo = {
    name: string;
    path: FilePath | FilePathWithPrefix;
    deleted?: boolean;
    isFolder: true;
    children: UXFileInfoStub[];
    parent: FilePath | FilePathWithPrefix | undefined;
};
export type UXDataWriteOptions = {
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
     */
    mtime?: number;
};
export type CacheData = string | ArrayBuffer;
export type FileEventType = "CREATE" | "DELETE" | "CHANGED" | "INTERNAL";
export type FileEventArgs = {
    file: UXFileInfoStub | UXInternalFileInfoStub;
    cache?: CacheData;
    oldPath?: string;
    ctx?: unknown;
};
export type FileEventItem = {
    type: FileEventType;
    args: FileEventArgs;
    key: string;
    skipBatchWait?: boolean;
    cancelled?: boolean;
    batched?: boolean;
};
export interface FileWithFileStat extends Omit<UXStat, "type"> {
    path: FilePath;
}
export interface FileWithStatAsProp {
    path: FilePath;
    stat: Omit<UXStat, "type">;
}
