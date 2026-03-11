import type { FilePath, UXStat } from "@/lib/src/common/types";
import type {
    IFileSystemAdapter,
    IPathAdapter,
    ITypeGuardAdapter,
    IConversionAdapter,
    IStorageAdapter,
    IVaultAdapter,
} from "@/lib/src/serviceModules/adapters";
import type { TAbstractFile, TFile, TFolder, Stat, App } from "obsidian";
import { ObsidianConversionAdapter } from "./ObsidianConversionAdapter";
import { ObsidianPathAdapter } from "./ObsidianPathAdapter";
import { ObsidianStorageAdapter } from "./ObsidianStorageAdapter";
import { ObsidianTypeGuardAdapter } from "./ObsidianTypeGuardAdapter";
import { ObsidianVaultAdapter } from "./ObsidianVaultAdapter";

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

export class ObsidianFileSystemAdapter implements IFileSystemAdapter<TAbstractFile, TFile, TFolder, Stat> {
    readonly path: IPathAdapter<TAbstractFile>;
    readonly typeGuard: ITypeGuardAdapter<TFile, TFolder>;
    readonly conversion: IConversionAdapter<TFile, TFolder>;
    readonly storage: IStorageAdapter<Stat>;
    readonly vault: IVaultAdapter<TFile>;

    constructor(private app: App) {
        this.path = new ObsidianPathAdapter();
        this.typeGuard = new ObsidianTypeGuardAdapter();
        this.conversion = new ObsidianConversionAdapter();
        this.storage = new ObsidianStorageAdapter(app);
        this.vault = new ObsidianVaultAdapter(app);
    }

    getAbstractFileByPath(path: FilePath | string): Promise<TAbstractFile | null> {
        return Promise.resolve(this.app.vault.getAbstractFileByPath(path));
    }

    getAbstractFileByPathInsensitive(path: FilePath | string): Promise<TAbstractFile | null> {
        return Promise.resolve(this.app.vault.getAbstractFileByPathInsensitive(path));
    }

    getFiles(): Promise<TFile[]> {
        return Promise.resolve(this.app.vault.getFiles());
    }

    statFromNative(file: TFile): Promise<UXStat> {
        return Promise.resolve({ ...file.stat, type: "file" });
    }

    async reconcileInternalFile(path: string): Promise<void> {
        return await Promise.resolve(this.app.vault.adapter.reconcileInternalFile?.(path));
    }
}
