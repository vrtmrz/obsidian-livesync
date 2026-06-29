// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePathWithPrefix } from "@lib/common/models/db.type";
import type { UXFileInfoStub } from "@lib/common/models/fileaccess.type";
import type { IStorageAccessManager } from "@lib/interfaces/StorageAccess";
import type { FileWithFileStat, FileWithStatAsProp } from "@lib/common/models/fileaccess.type";
export declare class StorageAccessManager implements IStorageAccessManager {
    processingFiles: Set<FilePathWithPrefix>;
    processWriteFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T>;
    processReadFile<T>(file: UXFileInfoStub | FilePathWithPrefix, proc: () => Promise<T>): Promise<T>;
    isFileProcessing(file: UXFileInfoStub | FilePathWithPrefix): boolean;
    private touchedFiles;
    touch(file: FileWithFileStat | FileWithStatAsProp): void;
    recentlyTouched(file: FileWithStatAsProp | FileWithFileStat): boolean;
    clearTouched(): void;
}
