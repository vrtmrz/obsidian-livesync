// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, FilePathWithPrefix, UXDataWriteOptions, UXFileInfo, UXFileInfoStub, UXFolderInfo, UXStat } from "@lib/common/types";
import { ServiceModuleBase } from "@lib/serviceModules/ServiceModuleBase";
import type { APIService } from "@lib/services/base/APIService";
import type { IStorageAccessManager, StorageAccess } from "@lib/interfaces/StorageAccess.ts";
import type { AppLifecycleService } from "@lib/services/base/AppLifecycleService";
import type { FileProcessingService } from "@lib/services/base/FileProcessingService";
import { StorageEventManager } from "@lib/interfaces/StorageEventManager.ts";
import { type CustomRegExp } from "@lib/common/utils";
import type { VaultService } from "@lib/services/base/VaultService";
import type { SettingService } from "@lib/services/base/SettingService";
import type { FileAccessBase, ExtractFile, ExtractFolder } from "@lib/serviceModules/FileAccessBase";
import type { IFileSystemAdapter } from "@lib/serviceModules/adapters";
export interface StorageAccessBaseDependencies<TAdapter extends IFileSystemAdapter<any, any, any, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    API: APIService;
    appLifecycle: AppLifecycleService;
    fileProcessing: FileProcessingService;
    vault: VaultService;
    setting: SettingService;
    storageEventManager: StorageEventManager;
    storageAccessManager: IStorageAccessManager;
    vaultAccess: FileAccessBase<TAdapter>;
}
export declare class ServiceFileAccessBase<TAdapter extends IFileSystemAdapter<any, any, any, any>> extends ServiceModuleBase<StorageAccessBaseDependencies<TAdapter>> implements StorageAccess { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    private vaultAccess;
    private vaultManager;
    private vault;
    private setting;
    constructor(services: StorageAccessBaseDependencies<TAdapter>);
    restoreState(): Promise<void>;
    _everyOnFirstInitialize(): Promise<boolean>;
    _everyCommitPendingFileEvent(): Promise<boolean>;
    normalisePath(path: string): string;
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
    readHiddenFileText(path: string): Promise<string>;
    readHiddenFileBinary(path: string): Promise<ArrayBuffer>;
    isExistsIncludeHidden(path: string): Promise<boolean>;
    ensureDir(path: string): Promise<boolean>;
    _triggerFileEvent(event: string, path: string): Promise<void>;
    triggerFileEvent(event: string, path: string): void;
    triggerHiddenFile(path: string): Promise<void>;
    getFileStub(path: string): Promise<UXFileInfoStub | null>;
    readStubContent(stub: UXFileInfoStub): Promise<UXFileInfo | false>;
    getStub(path: string): Promise<UXFileInfoStub | UXFolderInfo | null>;
    getFiles(): Promise<UXFileInfoStub[]>;
    getFileNames(): Promise<FilePath[]>;
    getFilesIncludeHidden(basePath: string, includeFilter?: CustomRegExp[], excludeFilter?: CustomRegExp[], skipFolder?: string[]): Promise<FilePath[]>;
    touched(file: UXFileInfoStub | FilePathWithPrefix): Promise<void>;
    recentlyTouched(file: UXFileInfoStub | FilePathWithPrefix): Promise<boolean>;
    clearTouched(): void;
    delete(file: FilePathWithPrefix | UXFileInfoStub | string, force: boolean): Promise<void>;
    trash(file: FilePathWithPrefix | UXFileInfoStub | string, system: boolean): Promise<void>;
    __deleteVaultItem(file: ExtractFile<TAdapter> | ExtractFolder<TAdapter>): Promise<void>;
    deleteVaultItem(fileSrc: FilePathWithPrefix | UXFileInfoStub | UXFolderInfo): Promise<void>;
}
