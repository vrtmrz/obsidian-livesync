import type {
    FilePath,
    FilePathWithPrefix,
    UXDataWriteOptions,
    UXFileInfo,
    UXFileInfoStub,
    UXFolderInfo,
    UXStat,
} from "../../lib/src/common/types";
import type { CustomRegExp } from "../../lib/src/common/utils";

export interface StorageAccess {
    processWriteFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T>;
    processReadFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T>;
    isFileProcessing(file: UXFileInfoStub | FilePathWithPrefix): boolean;

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
    // This could be work also for the hidden files.
    ensureDir(path: string): Promise<boolean>;
    triggerFileEvent(event: string, path: string): void;
    triggerHiddenFile(path: string): Promise<void>;

    getFileStub(path: string): UXFileInfoStub | null;
    readStubContent(stub: UXFileInfoStub): Promise<UXFileInfo | false>;
    getStub(path: string): UXFileInfoStub | UXFolderInfo | null;

    getFiles(): UXFileInfoStub[];
    getFileNames(): FilePathWithPrefix[];

    touched(file: UXFileInfoStub | FilePathWithPrefix): Promise<void>;
    recentlyTouched(file: UXFileInfoStub | FilePathWithPrefix): boolean;
    clearTouched(): void;

    // -- Low-Level
    delete(file: FilePathWithPrefix | UXFileInfoStub | string, force: boolean): Promise<void>;
    trash(file: FilePathWithPrefix | UXFileInfoStub | string, system: boolean): Promise<void>;

    getFilesIncludeHidden(
        basePath: string,
        includeFilter?: CustomRegExp[],
        excludeFilter?: CustomRegExp[],
        skipFolder?: string[]
    ): Promise<FilePath[]>;
}
