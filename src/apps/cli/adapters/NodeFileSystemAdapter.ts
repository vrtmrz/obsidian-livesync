import * as fs from "fs/promises";
import * as path from "path";
import type { FilePath, UXStat } from "@lib/common/types";
import type { IFileSystemAdapter } from "@lib/serviceModules/adapters";
import { NodePathAdapter } from "./NodePathAdapter";
import { NodeTypeGuardAdapter } from "./NodeTypeGuardAdapter";
import { NodeConversionAdapter } from "./NodeConversionAdapter";
import { NodeStorageAdapter } from "./NodeStorageAdapter";
import { NodeVaultAdapter } from "./NodeVaultAdapter";
import type { NodeFile, NodeFolder, NodeStat } from "./NodeTypes";

/**
 * Complete file system adapter implementation for Node.js
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter<NodeFile, NodeFile, NodeFolder, NodeStat> {
    readonly path: NodePathAdapter;
    readonly typeGuard: NodeTypeGuardAdapter;
    readonly conversion: NodeConversionAdapter;
    readonly storage: NodeStorageAdapter;
    readonly vault: NodeVaultAdapter;

    private fileCache = new Map<string, NodeFile>();

    constructor(private basePath: string) {
        this.path = new NodePathAdapter();
        this.typeGuard = new NodeTypeGuardAdapter();
        this.conversion = new NodeConversionAdapter();
        this.storage = new NodeStorageAdapter(basePath);
        this.vault = new NodeVaultAdapter(basePath);
    }

    private resolvePath(p: FilePath | string): string {
        return path.join(this.basePath, p);
    }

    private normalisePath(p: FilePath | string): string {
        return this.path.normalisePath(p as string);
    }

    async getAbstractFileByPath(p: FilePath | string): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);

        const cached = this.fileCache.get(pathStr);
        if (cached) {
            return cached;
        }

        return await this.refreshFile(pathStr);
    }

    async getAbstractFileByPathInsensitive(p: FilePath | string): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);

        const exact = await this.getAbstractFileByPath(pathStr);
        if (exact) {
            return exact;
        }

        const lowerPath = pathStr.toLowerCase();
        for (const [cachedPath, cachedFile] of this.fileCache.entries()) {
            if (cachedPath.toLowerCase() === lowerPath) {
                return cachedFile;
            }
        }

        await this.scanDirectory();

        for (const [cachedPath, cachedFile] of this.fileCache.entries()) {
            if (cachedPath.toLowerCase() === lowerPath) {
                return cachedFile;
            }
        }

        return null;
    }

    async getFiles(): Promise<NodeFile[]> {
        if (this.fileCache.size === 0) {
            await this.scanDirectory();
        }
        return Array.from(this.fileCache.values());
    }

    async statFromNative(file: NodeFile): Promise<UXStat> {
        return file.stat;
    }

    async reconcileInternalFile(p: string): Promise<void> {
        // No-op in Node.js version
        // This is used by Obsidian to sync internal file metadata
    }

    async refreshFile(p: string): Promise<NodeFile | null> {
        const pathStr = this.normalisePath(p);
        try {
            const fullPath = this.resolvePath(pathStr);
            const stat = await fs.stat(fullPath);
            if (!stat.isFile()) {
                this.fileCache.delete(pathStr);
                return null;
            }

            const file: NodeFile = {
                path: pathStr as FilePath,
                stat: {
                    size: stat.size,
                    mtime: stat.mtimeMs,
                    ctime: stat.ctimeMs,
                    type: "file",
                },
            };
            this.fileCache.set(pathStr, file);
            return file;
        } catch {
            this.fileCache.delete(pathStr);
            return null;
        }
    }

    /**
     * Helper method to recursively scan directory and populate file cache
     */
    async scanDirectory(relativePath: string = ""): Promise<void> {
        const fullPath = this.resolvePath(relativePath);
        try {
            const entries = await fs.readdir(fullPath, { withFileTypes: true });

            for (const entry of entries) {
                const entryRelativePath = path.join(relativePath, entry.name).replace(/\\/g, "/");

                if (entry.isDirectory()) {
                    await this.scanDirectory(entryRelativePath);
                } else if (entry.isFile()) {
                    const entryFullPath = this.resolvePath(entryRelativePath);
                    const stat = await fs.stat(entryFullPath);
                    const file: NodeFile = {
                        path: entryRelativePath as FilePath,
                        stat: {
                            size: stat.size,
                            mtime: stat.mtimeMs,
                            ctime: stat.ctimeMs,
                            type: "file",
                        },
                    };
                    this.fileCache.set(entryRelativePath, file);
                }
            }
        } catch (error) {
            // Directory doesn't exist or is not readable
            console.error(`Error scanning directory ${fullPath}:`, error);
        }
    }
}
