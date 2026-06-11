import type { UXDataWriteOptions } from "@lib/common/models/fileaccess.type";
import type { IVaultAdapter } from "@lib/serviceModules/adapters";
import type { TFile, App, TFolder } from "obsidian";
/**
 * Vault adapter implementation for Obsidian
 */
export declare class ObsidianVaultAdapter implements IVaultAdapter<TFile> {
    private app;
    constructor(app: App);
    read(file: TFile): Promise<string>;
    cachedRead(file: TFile): Promise<string>;
    readBinary(file: TFile): Promise<ArrayBuffer>;
    modify(file: TFile, data: string, options?: UXDataWriteOptions): Promise<void>;
    modifyBinary(file: TFile, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void>;
    create(path: string, data: string, options?: UXDataWriteOptions): Promise<TFile>;
    createBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<TFile>;
    delete(file: TFile | TFolder, force?: boolean): Promise<void>;
    trash(file: TFile | TFolder, force?: boolean): Promise<void>;
    trigger(name: string, ...data: any[]): any;
}
