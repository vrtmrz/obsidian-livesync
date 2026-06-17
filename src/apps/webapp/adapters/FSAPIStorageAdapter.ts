import type { UXDataWriteOptions } from "@lib/common/types";
import type { IStorageAdapter } from "@lib/serviceModules/adapters";
import type { FSAPIStat } from "./FSAPITypes";

/**
 * Storage adapter implementation for FileSystem API
 */
export class FSAPIStorageAdapter implements IStorageAdapter<FSAPIStat> {
    constructor(private rootHandle: FileSystemDirectoryHandle) {}

    /**
     * Resolve a path to directory and file handles
     */
    private async resolvePath(p: string): Promise<{
        dirHandle: FileSystemDirectoryHandle;
        fileName: string;
    } | null> {
        try {
            const parts = p.split("/").filter((part) => part !== "");
            if (parts.length === 0) {
                return null;
            }

            let currentHandle = this.rootHandle;
            const fileName = parts[parts.length - 1];

            // Navigate to the parent directory
            for (let i = 0; i < parts.length - 1; i++) {
                currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
            }

            return { dirHandle: currentHandle, fileName };
        } catch {
            return null;
        }
    }

    /**
     * Get file handle for a given path
     */
    private async getFileHandle(p: string): Promise<FileSystemFileHandle | null> {
        const resolved = await this.resolvePath(p);
        if (!resolved) return null;

        try {
            return await resolved.dirHandle.getFileHandle(resolved.fileName);
        } catch {
            return null;
        }
    }

    /**
     * Get directory handle for a given path
     */
    private async getDirectoryHandle(p: string): Promise<FileSystemDirectoryHandle | null> {
        try {
            const parts = p.split("/").filter((part) => part !== "");
            if (parts.length === 0) {
                return this.rootHandle;
            }

            let currentHandle = this.rootHandle;
            for (const part of parts) {
                currentHandle = await currentHandle.getDirectoryHandle(part);
            }

            return currentHandle;
        } catch {
            return null;
        }
    }

    async exists(p: string): Promise<boolean> {
        const fileHandle = await this.getFileHandle(p);
        if (fileHandle) return true;

        const dirHandle = await this.getDirectoryHandle(p);
        return dirHandle !== null;
    }

    async trystat(p: string): Promise<FSAPIStat | null> {
        // Try as file first
        const fileHandle = await this.getFileHandle(p);
        if (fileHandle) {
            const file = await fileHandle.getFile();
            return {
                size: file.size,
                mtime: file.lastModified,
                ctime: file.lastModified,
                type: "file",
            };
        }

        // Try as directory
        const dirHandle = await this.getDirectoryHandle(p);
        if (dirHandle) {
            return {
                size: 0,
                mtime: Date.now(),
                ctime: Date.now(),
                type: "folder",
            };
        }

        return null;
    }

    async stat(p: string): Promise<FSAPIStat | null> {
        return await this.trystat(p);
    }

    async mkdir(p: string): Promise<void> {
        const parts = p.split("/").filter((part) => part !== "");
        let currentHandle = this.rootHandle;

        for (const part of parts) {
            currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
        }
    }

    async remove(p: string): Promise<void> {
        const resolved = await this.resolvePath(p);
        if (!resolved) return;

        await resolved.dirHandle.removeEntry(resolved.fileName, { recursive: true });
    }

    async read(p: string): Promise<string> {
        const fileHandle = await this.getFileHandle(p);
        if (!fileHandle) {
            throw new Error(`File not found: ${p}`);
        }

        const file = await fileHandle.getFile();
        return await file.text();
    }

    async readBinary(p: string): Promise<ArrayBuffer> {
        const fileHandle = await this.getFileHandle(p);
        if (!fileHandle) {
            throw new Error(`File not found: ${p}`);
        }

        const file = await fileHandle.getFile();
        return await file.arrayBuffer();
    }

    async write(p: string, data: string, options?: UXDataWriteOptions): Promise<void> {
        const resolved = await this.resolvePath(p);
        if (!resolved) {
            throw new Error(`Invalid path: ${p}`);
        }

        // Ensure parent directory exists
        await this.mkdir(p.split("/").slice(0, -1).join("/"));

        const fileHandle = await resolved.dirHandle.getFileHandle(resolved.fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
    }

    async writeBinary(p: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        const resolved = await this.resolvePath(p);
        if (!resolved) {
            throw new Error(`Invalid path: ${p}`);
        }

        // Ensure parent directory exists
        await this.mkdir(p.split("/").slice(0, -1).join("/"));

        const fileHandle = await resolved.dirHandle.getFileHandle(resolved.fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
    }

    async append(p: string, data: string, options?: UXDataWriteOptions): Promise<void> {
        const existing = await this.exists(p);
        if (existing) {
            const currentContent = await this.read(p);
            await this.write(p, currentContent + data, options);
        } else {
            await this.write(p, data, options);
        }
    }

    async list(basePath: string): Promise<{ files: string[]; folders: string[] }> {
        const dirHandle = await this.getDirectoryHandle(basePath);
        if (!dirHandle) {
            return { files: [], folders: [] };
        }

        const files: string[] = [];
        const folders: string[] = [];

        // Use AsyncIterator instead of .values() for better compatibility
        for await (const [name, entry] of (dirHandle as any).entries()) {
            const entryPath = basePath ? `${basePath}/${name}` : name;

            if (entry.kind === "directory") {
                folders.push(entryPath);
            } else if (entry.kind === "file") {
                files.push(entryPath);
            }
        }

        return { files, folders };
    }
}
