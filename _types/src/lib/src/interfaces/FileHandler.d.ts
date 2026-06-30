// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, FilePathWithPrefix, MetaEntry } from "@lib/common/models/db.type";
import type { UXFileInfo, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/models/fileaccess.type";
export interface IFileHandler {
    readFileFromStub(file: UXFileInfoStub | UXFileInfo): Promise<UXFileInfo>;
    storeFileToDB(info: UXFileInfoStub | UXFileInfo | UXInternalFileInfoStub | FilePathWithPrefix, force?: boolean, onlyChunks?: boolean): Promise<boolean>;
    deleteFileFromDB(info: UXFileInfoStub | UXInternalFileInfoStub | FilePath): Promise<boolean>;
    deleteRevisionFromDB(info: UXFileInfoStub | FilePath | FilePathWithPrefix, rev: string): Promise<boolean | undefined>;
    resolveConflictedByDeletingRevision(info: UXFileInfoStub | FilePath, rev: string): Promise<boolean | undefined>;
    dbToStorageWithSpecificRev(info: UXFileInfoStub | UXFileInfo | FilePath | null, rev: string, force?: boolean): Promise<boolean>;
    dbToStorage(entryInfo: MetaEntry | FilePathWithPrefix, info: UXFileInfoStub | UXFileInfo | FilePath | null, force?: boolean): Promise<boolean>;
    createAllChunks(showingNotice?: boolean): Promise<void>;
}
