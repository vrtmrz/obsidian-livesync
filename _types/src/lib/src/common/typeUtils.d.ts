// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { DocumentID, FilePath, FilePathWithPrefix } from "./models/db.type";
import type { UXFileInfoStub } from "./types";
/**
 * returns is internal chunk of file
 * @param id ID
 * @returns
 */
export declare function isInternalMetadata(id: FilePath | FilePathWithPrefix | DocumentID): boolean;
export declare function isInternalFile(file: UXFileInfoStub | string | FilePathWithPrefix): boolean;
export declare function stripInternalMetadataPrefix<T extends FilePath | FilePathWithPrefix | DocumentID>(id: T): T;
export declare function id2InternalMetadataId(id: DocumentID): DocumentID;
export declare function isChunk(str: string): boolean;
export declare function isPluginMetadata(str: string): boolean;
export declare function isCustomisationSyncMetadata(str: string): boolean;
export declare function getPathFromUXFileInfo(file: UXFileInfoStub | string | FilePathWithPrefix): FilePathWithPrefix;
export declare function getStoragePathFromUXFileInfo(file: UXFileInfoStub | string | FilePathWithPrefix): FilePath;
export declare function getDatabasePathFromUXFileInfo(file: UXFileInfoStub | string | FilePathWithPrefix): FilePathWithPrefix;
