// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, UXDataWriteOptions, UXFileInfoStub, UXFolderInfo } from "@lib/common/types.ts";
import type { IStorageAccessManager } from "@lib/interfaces/StorageAccess.ts";
import type { IAPIService, IPathService, ISettingService, IVaultService } from "@lib/services/base/IService.ts";
import { createInstanceLogFunction } from "@lib/services/lib/logUtils.ts";
import type { FileWithFileStat } from "@lib/common/models/fileaccess.type";
import type { IFileSystemAdapter } from "./adapters";
export declare function toArrayBuffer(arr: Uint8Array | ArrayBuffer | DataView): ArrayBuffer;
export interface FileAccessBaseDependencies {
    vaultService: IVaultService;
    storageAccessManager: IStorageAccessManager;
    settingService: ISettingService;
    pathService: IPathService;
    APIService: IAPIService;
}
/**
 * Type helper to extract the abstract file type from a file system adapter
 */
export type ExtractAbstractFile<T> = T extends IFileSystemAdapter<infer A, any, any, any> ? A : never; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Type helper to extract the file type from a file system adapter
 */
export type ExtractFile<T> = T extends IFileSystemAdapter<any, infer F, any, any> ? F : never; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Type helper to extract the folder type from a file system adapter
 */
export type ExtractFolder<T> = T extends IFileSystemAdapter<any, any, infer D, any> ? D : never; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Type helper to extract the stat type from a file system adapter
 */
export type ExtractStat<T> = T extends IFileSystemAdapter<any, any, any, infer S> ? S : never; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
/**
 * Base class for file access operations
 * Uses adapter pattern for platform-specific implementations
 *
 * @template TAdapter - The file system adapter type, which determines all native file types
 */
export declare class FileAccessBase<TAdapter extends IFileSystemAdapter<any, any, any, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    protected storageAccessManager: IStorageAccessManager;
    protected vaultService: IVaultService;
    protected settingService: ISettingService;
    protected APIService: IAPIService;
    protected path: IPathService;
    protected adapter: TAdapter;
    _log: ReturnType<typeof createInstanceLogFunction>;
    constructor(adapter: TAdapter, dependencies: FileAccessBaseDependencies);
    isFile(file: UXFileInfoStub | ExtractAbstractFile<TAdapter> | FilePath | ExtractFolder<TAdapter> | ExtractFile<TAdapter> | null): file is ExtractFile<TAdapter>;
    isFolder(item: UXFileInfoStub | ExtractAbstractFile<TAdapter> | FilePath | ExtractFolder<TAdapter> | ExtractFile<TAdapter> | null): item is ExtractFolder<TAdapter>;
    getPath(file: ExtractAbstractFile<TAdapter> | string): FilePath;
    nativeFileToUXFileInfoStub(file: ExtractFile<TAdapter>): UXFileInfoStub;
    nativeFolderToUXFolder(file: ExtractFolder<TAdapter>): UXFolderInfo;
    normalisePath(path: string): string;
    protected _writeOp<T extends ExtractAbstractFile<TAdapter> | string, U>(file: T, callback: (path: FilePath, file: T) => Promise<U>): Promise<U>;
    protected _readOp<T extends ExtractAbstractFile<TAdapter> | string, U>(file: T, callback: (path: FilePath, file: T) => Promise<U>): Promise<U>;
    tryAdapterStat(file: ExtractFile<TAdapter> | string): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    adapterStat(file: ExtractFile<TAdapter> | string): Promise<ExtractStat<TAdapter> | null>;
    adapterExists(file: ExtractFile<TAdapter> | string): Promise<boolean>;
    adapterRemove(file: ExtractFile<TAdapter> | string): Promise<void>;
    adapterRead(file: ExtractFile<TAdapter> | string): Promise<string>;
    adapterReadBinary(file: ExtractFile<TAdapter> | string): Promise<ArrayBuffer>;
    adapterReadAuto(file: ExtractFile<TAdapter> | string): Promise<string | ArrayBuffer>;
    adapterWrite(file: ExtractFile<TAdapter> | string, data: string | ArrayBuffer | Uint8Array, options?: UXDataWriteOptions): Promise<void>;
    adapterList(basePath: string): Promise<{
        files: string[];
        folders: string[];
    }>;
    vaultCacheRead(file: ExtractFile<TAdapter>): Promise<string>;
    vaultRead(file: ExtractFile<TAdapter>): Promise<string>;
    vaultReadBinary(file: ExtractFile<TAdapter>): Promise<ArrayBuffer>;
    vaultReadAuto(file: ExtractFile<TAdapter>): Promise<string | ArrayBuffer>;
    vaultModify(file: ExtractFile<TAdapter>, data: string | ArrayBuffer | Uint8Array, options?: UXDataWriteOptions): Promise<boolean>;
    vaultCreate(path: string, data: string | ArrayBuffer | Uint8Array, options?: UXDataWriteOptions): Promise<ExtractFile<TAdapter>>;
    trigger(name: string, ...data: unknown[]): void;
    reconcileInternalFile(path: string): Promise<void>;
    /**
     * Append data to a file using the adapter's append method. This is useful for large files that cannot be read into memory.
     * Please note that this method does not check concurrent modifications.
     * @param normalizedPath
     * @param data
     * @param options
     * @returns
     */
    adapterAppend(normalizedPath: string, data: string, options?: UXDataWriteOptions): Promise<void>;
    delete(file: ExtractAbstractFile<TAdapter> | ExtractFolder<TAdapter>, force?: boolean): Promise<void>;
    trash(file: ExtractAbstractFile<TAdapter> | ExtractFolder<TAdapter>, force?: boolean): Promise<void>;
    protected isStorageInsensitive(): boolean;
    getAbstractFileByPath(path: FilePath | string): Promise<ExtractAbstractFile<TAdapter> | null>;
    getFiles(): Promise<ExtractFile<TAdapter>[]>;
    ensureDirectory(fullPath: string): Promise<void>;
    touch(file: ExtractFile<TAdapter> | FilePath): Promise<void>;
    recentlyTouched(file: ExtractFile<TAdapter> | UXFileInfoStub | FileWithFileStat): boolean;
    clearTouched(): void;
}
