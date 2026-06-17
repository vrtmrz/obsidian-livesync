import type { FilePath, UXStat } from "@lib/common/types";
import type { IFileSystemAdapter } from "@lib/serviceModules/adapters";
import { FSAPIPathAdapter } from "./FSAPIPathAdapter";
import { FSAPITypeGuardAdapter } from "./FSAPITypeGuardAdapter";
import { FSAPIConversionAdapter } from "./FSAPIConversionAdapter";
import { FSAPIStorageAdapter } from "./FSAPIStorageAdapter";
import { FSAPIVaultAdapter } from "./FSAPIVaultAdapter";
import type { FSAPIFile, FSAPIFolder, FSAPIStat } from "./FSAPITypes";
import { shareRunningResult } from "octagonal-wheels/concurrency/lock_v2";

/**
 * Complete file system adapter implementation for FileSystem API
 */
export class FSAPIFileSystemAdapter implements IFileSystemAdapter<FSAPIFile, FSAPIFile, FSAPIFolder, FSAPIStat> {
    readonly path: FSAPIPathAdapter;
    readonly typeGuard: FSAPITypeGuardAdapter;
    readonly conversion: FSAPIConversionAdapter;
    readonly storage: FSAPIStorageAdapter;
    readonly vault: FSAPIVaultAdapter;

    private fileCache = new Map<string, FSAPIFile>();
    private handleCache = new Map<string, FileSystemFileHandle>();

    constructor(private rootHandle: FileSystemDirectoryHandle) {
        this.path = new FSAPIPathAdapter();
        this.typeGuard = new FSAPITypeGuardAdapter();
        this.conversion = new FSAPIConversionAdapter();
        this.storage = new FSAPIStorageAdapter(rootHandle);
        this.vault = new FSAPIVaultAdapter(rootHandle);
    }

    private normalisePath(path: FilePath | string): string {
        return this.path.normalisePath(path as string);
    }

    /**
     * Get file handle for a given path
     */
    private async getFileHandleByPath(p: FilePath | string): Promise<FileSystemFileHandle | null> {
        const pathStr = p as string;

        // Check cache first
        const cached = this.handleCache.get(pathStr);
        if (cached) return cached;

        try {
            const parts = pathStr.split("/").filter((part) => part !== "");
            if (parts.length === 0) return null;

            let currentHandle: FileSystemDirectoryHandle = this.rootHandle;
            const fileName = parts[parts.length - 1];

            // Navigate to the parent directory
            for (let i = 0; i < parts.length - 1; i++) {
                currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
            }

            const fileHandle = await currentHandle.getFileHandle(fileName);
            this.handleCache.set(pathStr, fileHandle);
            return fileHandle;
        } catch {
            return null;
        }
    }

    async getAbstractFileByPath(p: FilePath | string): Promise<FSAPIFile | null> {
        const pathStr = this.normalisePath(p);

        const cached = this.fileCache.get(pathStr);
        if (cached) {
            return cached;
        }

        return await this.refreshFile(pathStr);
    }

    /**
     *
     */
    async getAbstractFileByPathInsensitive(p: FilePath | string): Promise<FSAPIFile | null> {
        const pathStr = this.normalisePath(p);
        const exact = await this.getAbstractFileByPath(pathStr);
        if (exact) {
            return exact;
        }
        // TODO: Refactor: Very, Very heavy.

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

    async getFiles(): Promise<FSAPIFile[]> {
        if (this.fileCache.size === 0) {
            await this.scanDirectory();
        }
        return Array.from(this.fileCache.values());
    }

    async statFromNative(file: FSAPIFile): Promise<UXStat> {
        // Refresh stat from the file handle
        try {
            const fileObject = await file.handle.getFile();
            return {
                size: fileObject.size,
                mtime: fileObject.lastModified,
                ctime: fileObject.lastModified,
                type: "file",
            };
        } catch {
            return file.stat;
        }
    }

    async reconcileInternalFile(p: string): Promise<void> {
        // No-op in webapp version
        // This is used by Obsidian to sync internal file metadata
    }

    /**
     * Refresh file cache for a specific path
     */
    async refreshFile(p: string): Promise<FSAPIFile | null> {
        const pathStr = this.normalisePath(p);
        const handle = await this.getFileHandleByPath(pathStr);
        if (!handle) {
            this.fileCache.delete(pathStr);
            this.handleCache.delete(pathStr);
            return null;
        }

        const fileObject = await handle.getFile();
        const file: FSAPIFile = {
            path: pathStr as FilePath,
            stat: {
                size: fileObject.size,
                mtime: fileObject.lastModified,
                ctime: fileObject.lastModified,
                type: "file",
            },
            handle: handle,
        };

        this.fileCache.set(pathStr, file);
        this.handleCache.set(pathStr, handle);
        return file;
    }

    /**
     * Helper method to recursively scan directory and populate file cache
     */
    async scanDirectory(relativePath: string = ""): Promise<void> {
        return shareRunningResult("scanDirectory:" + relativePath, async () => {
            try {
                const parts = relativePath.split("/").filter((part) => part !== "");
                let currentHandle = this.rootHandle;

                for (const part of parts) {
                    currentHandle = await currentHandle.getDirectoryHandle(part);
                }

                // Use AsyncIterator instead of .values() for better compatibility
                for await (const [name, entry] of (currentHandle as any).entries()) {
                    const entryPath = relativePath ? `${relativePath}/${name}` : name;

                    if (entry.kind === "directory") {
                        // Recursively scan subdirectories
                        await this.scanDirectory(entryPath);
                    } else if (entry.kind === "file") {
                        const fileHandle = entry as FileSystemFileHandle;
                        const fileObject = await fileHandle.getFile();

                        const file: FSAPIFile = {
                            path: entryPath as FilePath,
                            stat: {
                                size: fileObject.size,
                                mtime: fileObject.lastModified,
                                ctime: fileObject.lastModified,
                                type: "file",
                            },
                            handle: fileHandle,
                        };

                        this.fileCache.set(entryPath, file);
                        this.handleCache.set(entryPath, fileHandle);
                    }
                }
            } catch (error) {
                console.error(`Error scanning directory ${relativePath}:`, error);
            }
        });
    }

    /**
     * Clear all caches
     */
    clearCache(): void {
        this.fileCache.clear();
        this.handleCache.clear();
    }
}
