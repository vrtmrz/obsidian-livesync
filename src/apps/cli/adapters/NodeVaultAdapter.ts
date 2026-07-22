import type { FilePath, UXDataWriteOptions } from "@vrtmrz/livesync-commonlib/compat/common/types";
import type { IVaultAdapter } from "@vrtmrz/livesync-commonlib/compat/serviceModules/adapters";
import type { NodeFile, NodeFolder } from "./NodeTypes";
import { NodeStorageAdapter } from "@vrtmrz/livesync-commonlib/node";

/**
 * Vault adapter implementation for Node.js
 */
export class NodeVaultAdapter implements IVaultAdapter<NodeFile> {
    private readonly storage: NodeStorageAdapter;

    constructor(rootPathOrStorage: string | NodeStorageAdapter) {
        this.storage =
            typeof rootPathOrStorage === "string" ? new NodeStorageAdapter(rootPathOrStorage) : rootPathOrStorage;
    }

    async read(file: NodeFile): Promise<string> {
        const content = await this.storage.read(file.path);
        // Correct stale stat.size — chokidar stats may be from a poll before the final write.
        // The downstream document integrity check compares stat.size to content length, so
        // they must agree or other clients reject the file as corrupted.
        file.stat.size = Buffer.byteLength(content, "utf-8");
        return content;
    }

    async cachedRead(file: NodeFile): Promise<string> {
        // No caching in CLI version, just read directly
        return await this.read(file);
    }

    async readBinary(file: NodeFile): Promise<ArrayBuffer> {
        const buffer = await this.storage.readBinary(file.path);
        // Same correction as read() — ensure stat.size matches actual byte length.
        file.stat.size = buffer.byteLength;
        return buffer;
    }

    async modify(file: NodeFile, data: string, options?: UXDataWriteOptions): Promise<void> {
        await this.storage.write(file.path, data, options);
    }

    async modifyBinary(file: NodeFile, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        await this.storage.writeBinary(file.path, data, options);
    }

    async create(p: string, data: string, options?: UXDataWriteOptions): Promise<NodeFile> {
        await this.storage.write(p, data, options);
        return await this.toNodeFile(p);
    }

    async createBinary(p: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<NodeFile> {
        await this.storage.writeBinary(p, data, options);
        return await this.toNodeFile(p);
    }

    async rename(file: NodeFile, newPath: string): Promise<void> {
        await this.storage.rename(file.path, newPath);
        file.path = newPath as FilePath;
    }

    async delete(file: NodeFile | NodeFolder, force = false): Promise<void> {
        await this.storage.remove(file.path);
    }

    async trash(file: NodeFile | NodeFolder, force = false): Promise<void> {
        // In CLI, trash is the same as delete (no recycle bin)
        await this.delete(file, force);
    }

    trigger(name: string, ...data: unknown[]): void {
        // No-op in CLI version (no event system)
        return undefined;
    }

    private async toNodeFile(path: string): Promise<NodeFile> {
        const stat = await this.storage.stat(path);
        if (stat?.type !== "file") throw new Error(`Could not read created file metadata: ${path}`);
        return { path: path as FilePath, stat };
    }
}
