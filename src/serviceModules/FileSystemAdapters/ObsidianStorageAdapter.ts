import type { UXDataWriteOptions } from "@lib/common/types";
import type { IStorageAdapter } from "@lib/serviceModules/adapters";
import { toArrayBuffer } from "@lib/serviceModules/FileAccessBase";
import type { Stat, App } from "obsidian";

/**
 * Storage adapter implementation for Obsidian
 */

export class ObsidianStorageAdapter implements IStorageAdapter<Stat> {
    constructor(private app: App) {}

    async exists(path: string): Promise<boolean> {
        return await this.app.vault.adapter.exists(path);
    }

    async trystat(path: string): Promise<Stat | null> {
        if (!(await this.app.vault.adapter.exists(path))) return null;
        return await this.app.vault.adapter.stat(path);
    }

    async stat(path: string): Promise<Stat | null> {
        return await this.app.vault.adapter.stat(path);
    }

    async mkdir(path: string): Promise<void> {
        await this.app.vault.adapter.mkdir(path);
    }

    async remove(path: string): Promise<void> {
        await this.app.vault.adapter.remove(path);
    }

    async read(path: string): Promise<string> {
        return await this.app.vault.adapter.read(path);
    }

    async readBinary(path: string): Promise<ArrayBuffer> {
        return await this.app.vault.adapter.readBinary(path);
    }

    async write(path: string, data: string, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.adapter.write(path, data, options);
    }

    async writeBinary(path: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.adapter.writeBinary(path, toArrayBuffer(data), options);
    }

    async append(path: string, data: string, options?: UXDataWriteOptions): Promise<void> {
        return await this.app.vault.adapter.append(path, data, options);
    }

    list(basePath: string): Promise<{ files: string[]; folders: string[] }> {
        return Promise.resolve(this.app.vault.adapter.list(basePath));
    }
}
