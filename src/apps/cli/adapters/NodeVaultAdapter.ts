import * as fs from "fs/promises";
import * as path from "path";
import type { UXDataWriteOptions } from "@lib/common/types";
import type { IVaultAdapter } from "@lib/serviceModules/adapters";
import type { NodeFile, NodeFolder, NodeStat } from "./NodeTypes";

/**
 * Vault adapter implementation for Node.js
 */
export class NodeVaultAdapter implements IVaultAdapter<NodeFile> {
    constructor(private basePath: string) {}

    private resolvePath(p: string): string {
        return path.join(this.basePath, p);
    }

    async read(file: NodeFile): Promise<string> {
        return await fs.readFile(this.resolvePath(file.path), "utf-8");
    }

    async cachedRead(file: NodeFile): Promise<string> {
        // No caching in CLI version, just read directly
        return await this.read(file);
    }

    async readBinary(file: NodeFile): Promise<ArrayBuffer> {
        const buffer = await fs.readFile(this.resolvePath(file.path));
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    }

    async modify(file: NodeFile, data: string, options?: UXDataWriteOptions): Promise<void> {
        const fullPath = this.resolvePath(file.path);
        await fs.writeFile(fullPath, data, "utf-8");

        if (options?.mtime || options?.ctime) {
            const atime = options.mtime ? new Date(options.mtime) : new Date();
            const mtime = options.mtime ? new Date(options.mtime) : new Date();
            await fs.utimes(fullPath, atime, mtime);
        }
    }

    async modifyBinary(file: NodeFile, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        const fullPath = this.resolvePath(file.path);
        await fs.writeFile(fullPath, new Uint8Array(data));

        if (options?.mtime || options?.ctime) {
            const atime = options.mtime ? new Date(options.mtime) : new Date();
            const mtime = options.mtime ? new Date(options.mtime) : new Date();
            await fs.utimes(fullPath, atime, mtime);
        }
    }

    async create(p: string, data: string, options?: UXDataWriteOptions): Promise<NodeFile> {
        const fullPath = this.resolvePath(p);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, data, "utf-8");

        if (options?.mtime || options?.ctime) {
            const atime = options.mtime ? new Date(options.mtime) : new Date();
            const mtime = options.mtime ? new Date(options.mtime) : new Date();
            await fs.utimes(fullPath, atime, mtime);
        }

        const stat = await fs.stat(fullPath);
        return {
            path: p as any,
            stat: {
                size: stat.size,
                mtime: stat.mtimeMs,
                ctime: stat.ctimeMs,
                type: "file",
            },
        };
    }

    async createBinary(p: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<NodeFile> {
        const fullPath = this.resolvePath(p);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, new Uint8Array(data));

        if (options?.mtime || options?.ctime) {
            const atime = options.mtime ? new Date(options.mtime) : new Date();
            const mtime = options.mtime ? new Date(options.mtime) : new Date();
            await fs.utimes(fullPath, atime, mtime);
        }

        const stat = await fs.stat(fullPath);
        return {
            path: p as any,
            stat: {
                size: stat.size,
                mtime: stat.mtimeMs,
                ctime: stat.ctimeMs,
                type: "file",
            },
        };
    }

    async delete(file: NodeFile | NodeFolder, force = false): Promise<void> {
        const fullPath = this.resolvePath(file.path);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force });
        } else {
            await fs.unlink(fullPath);
        }
    }

    async trash(file: NodeFile | NodeFolder, force = false): Promise<void> {
        // In CLI, trash is the same as delete (no recycle bin)
        await this.delete(file, force);
    }

    trigger(name: string, ...data: any[]): any {
        // No-op in CLI version (no event system)
        return undefined;
    }
}
