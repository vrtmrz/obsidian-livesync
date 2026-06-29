// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, UXStat } from "@lib/common/types.ts";
import type { IPathAdapter } from "./IPathAdapter.ts";
import type { ITypeGuardAdapter } from "./ITypeGuardAdapter.ts";
import type { IConversionAdapter } from "./IConversionAdapter.ts";
import type { IStorageAdapter } from "./IStorageAdapter.ts";
import type { IVaultAdapter } from "./IVaultAdapter.ts";
/**
 * Main file system adapter interface
 * Composes all other adapters and provides platform-specific operations
 */
export interface IFileSystemAdapter<TNativeAbstractFile = any, TNativeFile = any, TNativeFolder = any, TStat extends UXStat = UXStat> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Only type declaration
    /** Path operations */
    readonly path: IPathAdapter<TNativeAbstractFile>;
    /** Type guard operations */
    readonly typeGuard: ITypeGuardAdapter<TNativeFile, TNativeFolder>;
    /** Conversion operations */
    readonly conversion: IConversionAdapter<TNativeFile, TNativeFolder>;
    /** Storage operations */
    readonly storage: IStorageAdapter<TStat>;
    /** Vault operations */
    readonly vault: IVaultAdapter<TNativeFile>;
    /**
     * Get a file or folder by path (case-sensitive)
     */
    getAbstractFileByPath(path: FilePath | string): Promise<TNativeAbstractFile | null>;
    /**
     * Get a file or folder by path (case-insensitive)
     */
    getAbstractFileByPathInsensitive(path: FilePath | string): Promise<TNativeAbstractFile | null>;
    /**
     * Get all files in the vault
     */
    getFiles(): Promise<TNativeFile[]>;
    /**
     * Get file statistics from a native file object
     */
    statFromNative(file: TNativeFile): Promise<UXStat>;
    /**
     * Reconcile internal file state
     * Platform-specific operation for syncing internal metadata
     */
    reconcileInternalFile(path: string): Promise<void>;
}
