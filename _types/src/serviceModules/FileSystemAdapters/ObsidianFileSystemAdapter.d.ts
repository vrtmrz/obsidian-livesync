// @ts-nocheck
// REPO: https://github.com/vrtmrz/livesync-commonlib  Commit hash: 87dc724
import type { FilePath, UXStat } from "@lib/common/types";
import type { IFileSystemAdapter, IPathAdapter, ITypeGuardAdapter, IConversionAdapter, IStorageAdapter, IVaultAdapter } from "@lib/serviceModules/adapters";
import type { TAbstractFile, TFile, TFolder, Stat, App } from "obsidian";
declare module "obsidian" {
    interface Vault {
        getAbstractFileByPathInsensitive(path: string): TAbstractFile | null;
    }
    interface DataAdapter {
        reconcileInternalFile?(path: string): Promise<void>;
    }
}
/**
 * Complete file system adapter implementation for Obsidian
 */
export declare class ObsidianFileSystemAdapter implements IFileSystemAdapter<TAbstractFile, TFile, TFolder, Stat> {
    private app;
    readonly path: IPathAdapter<TAbstractFile>;
    readonly typeGuard: ITypeGuardAdapter<TFile, TFolder>;
    readonly conversion: IConversionAdapter<TFile, TFolder>;
    readonly storage: IStorageAdapter<Stat>;
    readonly vault: IVaultAdapter<TFile>;
    constructor(app: App);
    getAbstractFileByPath(path: FilePath | string): Promise<TAbstractFile | null>;
    getAbstractFileByPathInsensitive(path: FilePath | string): Promise<TAbstractFile | null>;
    getFiles(): Promise<TFile[]>;
    statFromNative(file: TFile): Promise<UXStat>;
    reconcileInternalFile(path: string): Promise<void>;
}
