import type { UXDataWriteOptions } from "@/lib/src/common/types";
import type { IVaultAdapter } from "@/lib/src/serviceModules/adapters";
import { toArrayBuffer } from "@/lib/src/serviceModules/FileAccessBase";
import type { TFile, App, TFolder } from "obsidian";

/**
 * Vault adapter implementation for Obsidian
 */
export class ObsidianVaultAdapter implements IVaultAdapter<TFile> {
    constructor(private app: App) {}

    async read(file: TFile): Promise<string> {
        return await this.app.vault.read(file);
    }

    async cachedRead(file: TFile): Promise<string> {
        return await this.app.vault.cachedRead(file);
    }

    async readBinary(file: TFile): Promise<ArrayBuffer> {
        return await this.app.vault.readBinary(file);
    }

    async modify(file: TFile, data: string, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.modify(file, data, options);
    }

    async modifyBinary(file: TFile, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.modifyBinary(file, toArrayBuffer(data), options);
    }

    async create(path: string, data: string, options?: UXDataWriteOptions): Promise<TFile> {
        return await this.app.vault.create(path, data, options);
    }

    async createBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<TFile> {
        return await this.app.vault.createBinary(path, toArrayBuffer(data), options);
    }

    async delete(file: TFile | TFolder, force = false): Promise<void> {
        // if ("trashFile" in this.app.fileManager) {
        //     // eslint-disable-next-line obsidianmd/no-unsupported-api
        //     return await this.app.fileManager.trashFile(file);
        // }
        //TODO: need fix
        return await this.app.vault.delete(file, force);
    }

    async trash(file: TFile | TFolder, force = false): Promise<void> {
        // if ("trashFile" in this.app.fileManager) {
        //     // eslint-disable-next-line obsidianmd/no-unsupported-api
        //     return await this.app.fileManager.trashFile(file);
        // }
        //TODO: need fix
        return await this.app.vault.trash(file, force);
    }

    trigger(name: string, ...data: any[]): any {
        return this.app.vault.trigger(name, ...data);
    }
}
