// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, FilePathWithPrefix, UXDataWriteOptions, UXFileInfo, UXFileInfoStub, UXFolderInfo, UXStat } from "@lib/common/types";
import type { CustomRegExp } from "@lib/common/utils";
import type { FileWithFileStat, FileWithStatAsProp } from "@lib/common/models/fileaccess.type";
export interface IStorageAccessManager {
    processWriteFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T>;
    processReadFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T>;
    isFileProcessing(file: UXFileInfoStub | FilePathWithPrefix): boolean;
    recentlyTouched(file: FileWithStatAsProp | FileWithFileStat): boolean;
    touch(file: FileWithStatAsProp | FileWithFileStat): void;
    clearTouched(): void;
}
export interface StorageAccess {
    normalisePath(path: string): string;
    restoreState(): Promise<void>;
    deleteVaultItem(file: FilePathWithPrefix | UXFileInfoStub | UXFolderInfo): Promise<void>;
    writeFileAuto(path: string, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<boolean>;
    readFileAuto(path: string): Promise<string | ArrayBuffer>;
    readFileText(path: string): Promise<string>;
    isExists(path: string): Promise<boolean>;
    writeHiddenFileAuto(path: string, data: string | ArrayBuffer, opt?: UXDataWriteOptions): Promise<boolean>;
    appendHiddenFile(path: string, data: string, opt?: UXDataWriteOptions): Promise<boolean>;
    stat(path: string): Promise<UXStat | null>;
    statHidden(path: string): Promise<UXStat | null>;
    removeHidden(path: string): Promise<boolean>;
    readHiddenFileAuto(path: string): Promise<string | ArrayBuffer>;
    readHiddenFileBinary(path: string): Promise<ArrayBuffer>;
    readHiddenFileText(path: string): Promise<string>;
    isExistsIncludeHidden(path: string): Promise<boolean>;
    ensureDir(path: string): Promise<boolean>;
    triggerFileEvent(event: string, path: string): void;
    triggerHiddenFile(path: string): Promise<void>;
    getFileStub(path: string): Promise<UXFileInfoStub | null>;
    readStubContent(stub: UXFileInfoStub): Promise<UXFileInfo | false>;
    getStub(path: string): Promise<UXFileInfoStub | UXFolderInfo | null>;
    getFiles(): Promise<UXFileInfoStub[]>;
    getFileNames(): Promise<FilePathWithPrefix[]>;
    touched(file: UXFileInfoStub | FilePathWithPrefix): Promise<void>;
    recentlyTouched(file: UXFileInfoStub | FilePathWithPrefix): Promise<boolean>;
    clearTouched(): void;
    delete(file: FilePathWithPrefix | UXFileInfoStub | string, force: boolean): Promise<void>;
    trash(file: FilePathWithPrefix | UXFileInfoStub | string, system: boolean): Promise<void>;
    getFilesIncludeHidden(basePath: string, includeFilter?: CustomRegExp[], excludeFilter?: CustomRegExp[], skipFolder?: string[]): Promise<FilePath[]>;
}
