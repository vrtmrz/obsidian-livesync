import * as fs from "fs/promises";
import * as path from "path";
import type { UXDataWriteOptions } from "@lib/common/types";
import type { IStorageAdapter } from "@lib/serviceModules/adapters";
import type { NodeStat } from "./NodeTypes";

/**
 * Storage adapter implementation for Node.js
 */
export class NodeStorageAdapter implements IStorageAdapter<NodeStat> {
    constructor(private basePath: string) {}

    private resolvePath(p: string): string {
        return path.join(this.basePath, p);
    }

    async exists(p: string): Promise<boolean> {
        try {
            await fs.access(this.resolvePath(p));
            return true;
        } catch {
            return false;
        }
    }

    async trystat(p: string): Promise<NodeStat | null> {
        try {
            const stat = await fs.stat(this.resolvePath(p));
            return {
                size: stat.size,
                mtime: stat.mtimeMs,
                ctime: stat.ctimeMs,
                type: stat.isDirectory() ? "folder" : "file",
            };
        } catch {
            return null;
        }
    }

    async stat(p: string): Promise<NodeStat | null> {
        return await this.trystat(p);
    }

    async mkdir(p: string): Promise<void> {
        await fs.mkdir(this.resolvePath(p), { recursive: true });
    }

    async remove(p: string): Promise<void> {
        const fullPath = this.resolvePath(p);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            await fs.rm(fullPath, { recursive: true, force: true });
        } else {
            await fs.unlink(fullPath);
        }
    }

    async read(p: string): Promise<string> {
        return await fs.readFile(this.resolvePath(p), "utf-8");
    }

    async readBinary(p: string): Promise<ArrayBuffer> {
        const buffer = await fs.readFile(this.resolvePath(p));
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    }

    async write(p: string, data: string, options?: UXDataWriteOptions): Promise<void> {
        const fullPath = this.resolvePath(p);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, data, "utf-8");

        if (options?.mtime || options?.ctime) {
            const atime = options.mtime ? new Date(options.mtime) : new Date();
            const mtime = options.mtime ? new Date(options.mtime) : new Date();
            await fs.utimes(fullPath, atime, mtime);
        }
    }

    async writeBinary(p: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        const fullPath = this.resolvePath(p);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, new Uint8Array(data));

        if (options?.mtime || options?.ctime) {
            const atime = options.mtime ? new Date(options.mtime) : new Date();
            const mtime = options.mtime ? new Date(options.mtime) : new Date();
            await fs.utimes(fullPath, atime, mtime);
        }
    }

    async append(p: string, data: string, options?: UXDataWriteOptions): Promise<void> {
        const fullPath = this.resolvePath(p);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.appendFile(fullPath, data, "utf-8");

        if (options?.mtime || options?.ctime) {
            const atime = options.mtime ? new Date(options.mtime) : new Date();
            const mtime = options.mtime ? new Date(options.mtime) : new Date();
            await fs.utimes(fullPath, atime, mtime);
        }
    }

    async list(basePath: string): Promise<{ files: string[]; folders: string[] }> {
        const fullPath = this.resolvePath(basePath);
        try {
            const entries = await fs.readdir(fullPath, { withFileTypes: true });
            const files: string[] = [];
            const folders: string[] = [];

            for (const entry of entries) {
                const entryPath = path.join(basePath, entry.name).replace(/\\/g, "/");
                if (entry.isDirectory()) {
                    folders.push(entryPath);
                } else if (entry.isFile()) {
                    files.push(entryPath);
                }
            }

            return { files, folders };
        } catch {
            return { files: [], folders: [] };
        }
    }
}
