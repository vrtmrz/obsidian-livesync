import type { UXDataWriteOptions } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IVaultAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters";
import { toArrayBuffer } from "@vrtmrz/livesync-commonlib/compat/serviceModules/FileAccessBase";
import type { TFile, App, TFolder } from "obsidian";
import { toIntegerTimestamps } from "./sanitizeWriteOptions";

/**
 * Vault adapter implementation for Obsidian
 */
export class ObsidianVaultAdapter implements IVaultAdapter<TFile, TFolder> {
    constructor(private app: App) {}

    async read(file: TFile): Promise<string> {
        // Vault.read strips a leading UTF-8 BOM, leaving the content size inconsistent with TFile.stat.
        return await this.app.vault.adapter.read(file.path);
    }

    async cachedRead(file: TFile): Promise<string> {
        return await this.app.vault.cachedRead(file);
    }

    async readBinary(file: TFile): Promise<ArrayBuffer> {
        return await this.app.vault.readBinary(file);
    }

    async modify(file: TFile, data: string, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.modify(file, data, toIntegerTimestamps(options));
    }

    async modifyBinary(file: TFile, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.modifyBinary(file, toArrayBuffer(data), toIntegerTimestamps(options));
    }

    async create(path: string, data: string, options?: UXDataWriteOptions): Promise<TFile> {
        return await this.app.vault.create(path, data, toIntegerTimestamps(options));
    }

    async createBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<TFile> {
        return await this.app.vault.createBinary(path, toArrayBuffer(data), toIntegerTimestamps(options));
    }

    async rename(file: TFile, newPath: string): Promise<void> {
        return await this.app.vault.rename(file, newPath);
    }

    async delete(file: TFile | TFolder): Promise<void> {
        return await this.app.fileManager.trashFile(file);
    }

    async trash(file: TFile | TFolder): Promise<void> {
        return await this.app.fileManager.trashFile(file);
    }

    trigger(name: string, ...data: unknown[]): void {
        return this.app.vault.trigger(name, ...data);
    }
}
