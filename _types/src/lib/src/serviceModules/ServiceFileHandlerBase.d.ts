// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { AnyEntry, FilePath, FilePathWithPrefix, MetaEntry, UXFileInfo, UXFileInfoStub, UXInternalFileInfoStub } from "@lib/common/types";
import type { IFileHandler } from "@lib/interfaces/FileHandler.ts";
import { ServiceModuleBase } from "@lib/serviceModules/ServiceModuleBase";
import type { APIService } from "@lib/services/base/APIService.ts";
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess.ts";
import type { StorageAccess } from "@lib/interfaces/StorageAccess.ts";
import type { FileProcessingService } from "@lib/services/base/FileProcessingService.ts";
import type { ReplicationService } from "@lib/services/base/ReplicationService.ts";
import type { ConflictService } from "@lib/services/base/ConflictService.ts";
import type { PathService } from "@lib/services/base/PathService.ts";
import type { SettingService } from "@lib/services/base/SettingService.ts";
import type { VaultService } from "@lib/services/base/VaultService.ts";
export interface ServiceFileHandlerDependencies {
    API: APIService;
    databaseFileAccess: DatabaseFileAccess;
    storageAccess: StorageAccess;
    fileProcessing: FileProcessingService;
    replication: ReplicationService;
    conflict: ConflictService;
    path: PathService;
    setting: SettingService;
    vault: VaultService;
}
export declare abstract class ServiceFileHandlerBase extends ServiceModuleBase<ServiceFileHandlerDependencies> implements IFileHandler {
    private databaseFileAccess;
    private storageAccess;
    private conflict;
    private path;
    private setting;
    private vault;
    constructor(services: ServiceFileHandlerDependencies);
    get db(): DatabaseFileAccess;
    get storage(): StorageAccess;
    getPath(entry: AnyEntry): FilePathWithPrefix;
    getPathWithoutPrefix(entry: AnyEntry): FilePathWithPrefix;
    readFileFromStub(file: UXFileInfoStub | UXFileInfo): Promise<UXFileInfo>;
    private infoToStub;
    storeFileToDB(info: UXFileInfoStub | UXFileInfo | UXInternalFileInfoStub | FilePathWithPrefix, force?: boolean, onlyChunks?: boolean): Promise<boolean>;
    deleteFileFromDB(info: UXFileInfoStub | UXInternalFileInfoStub | FilePath): Promise<boolean>;
    deleteRevisionFromDB(info: UXFileInfoStub | FilePath | FilePathWithPrefix, rev: string): Promise<boolean | undefined>;
    resolveConflictedByDeletingRevision(info: UXFileInfoStub | FilePath, rev: string): Promise<boolean | undefined>;
    dbToStorageWithSpecificRev(info: UXFileInfoStub | UXFileInfo | FilePath | null, rev: string, force?: boolean): Promise<boolean>;
    dbToStorage(entryInfo: MetaEntry | FilePathWithPrefix, info: UXFileInfoStub | UXFileInfo | FilePath | null, force?: boolean): Promise<boolean>;
    private preserveUnsyncedStorageAsConflict;
    private _anyHandlerProcessesFileEvent;
    _anyProcessReplicatedDoc(entry: MetaEntry): Promise<boolean>;
    createAllChunks(showingNotice?: boolean): Promise<void>;
}
