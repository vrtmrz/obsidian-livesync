// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { UXFileInfoStub, FilePathWithPrefix, UXFileInfo, MetaEntry, LoadedEntry, FilePath } from "@lib/common/types";
import type { DatabaseFileAccess } from "@lib/interfaces/DatabaseFileAccess";
import type { StorageAccess } from "@lib/interfaces/StorageAccess";
import type { APIService } from "@lib/services/base/APIService";
import type { DatabaseService } from "@lib/services/base/DatabaseService";
import type { PathService } from "@lib/services/base/PathService";
import type { VaultService } from "@lib/services/base/VaultService";
import { ServiceModuleBase } from "@lib/serviceModules/ServiceModuleBase";
export interface ServiceDatabaseFileAccessDependencies {
    API: APIService;
    vault: VaultService;
    storageAccess: StorageAccess;
    path: PathService;
    database: DatabaseService;
}
export declare class ServiceDatabaseFileAccessBase extends ServiceModuleBase<ServiceDatabaseFileAccessDependencies> implements DatabaseFileAccess {
    private vault;
    private storageAccess;
    private path;
    private database;
    constructor(services: ServiceDatabaseFileAccessDependencies);
    checkIsTargetFile(file: UXFileInfoStub | FilePathWithPrefix): Promise<boolean>;
    delete(file: UXFileInfoStub | FilePathWithPrefix, rev?: string): Promise<boolean>;
    createChunks(file: UXFileInfo, force?: boolean, skipCheck?: boolean): Promise<boolean>;
    store(file: UXFileInfo, force?: boolean, skipCheck?: boolean): Promise<boolean>;
    storeAsConflictedRevision(file: UXFileInfo, currentRev: string, skipCheck?: boolean): Promise<boolean>;
    storeContent(path: FilePathWithPrefix, content: string): Promise<boolean>;
    private __store;
    private getParentRev;
    hasContentInRevisionHistory(file: UXFileInfoStub | FilePathWithPrefix, content: string | string[] | Blob | ArrayBuffer, currentRev?: string): Promise<boolean>;
    getConflictedRevs(file: UXFileInfoStub | FilePathWithPrefix): Promise<string[]>;
    fetch(file: UXFileInfoStub | FilePathWithPrefix, rev?: string, waitForReady?: boolean, skipCheck?: boolean): Promise<UXFileInfo | false>;
    fetchEntryMeta(file: UXFileInfoStub | FilePathWithPrefix, rev?: string, skipCheck?: boolean): Promise<MetaEntry | false>;
    fetchEntryFromMeta(meta: MetaEntry, waitForReady?: boolean, skipCheck?: boolean): Promise<LoadedEntry | false>;
    fetchEntry(file: UXFileInfoStub | FilePathWithPrefix, rev?: string, waitForReady?: boolean, skipCheck?: boolean): Promise<LoadedEntry | false>;
    deleteFromDBbyPath(fullPath: FilePath | FilePathWithPrefix, rev?: string): Promise<boolean>;
}
