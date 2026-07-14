import type { FilePath, UXDataWriteOptions } from "@lib/common/types";
import type { IVaultAdapter } from "@lib/serviceModules/adapters";
import type { FSAPIFile, FSAPIFolder } from "./FSAPITypes";

/**
 * Vault adapter implementation for FileSystem API
 */
export class FSAPIVaultAdapter implements IVaultAdapter<FSAPIFile> {
    constructor(private rootHandle: FileSystemDirectoryHandle) {}

    async read(file: FSAPIFile): Promise<string> {
        const fileObject = await file.handle.getFile();
        return await fileObject.text();
    }

    async cachedRead(file: FSAPIFile): Promise<string> {
        // No caching in webapp version, just read directly
        return await this.read(file);
    }

    async readBinary(file: FSAPIFile): Promise<ArrayBuffer> {
        const fileObject = await file.handle.getFile();
        return await fileObject.arrayBuffer();
    }

    async modify(file: FSAPIFile, data: string, options?: UXDataWriteOptions): Promise<void> {
        const writable = await file.handle.createWritable();
        await writable.write(data);
        await writable.close();
    }

    async modifyBinary(file: FSAPIFile, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<void> {
        const writable = await file.handle.createWritable();
        await writable.write(data);
        await writable.close();
    }

    async create(p: string, data: string, options?: UXDataWriteOptions): Promise<FSAPIFile> {
        const parts = p.split("/").filter((part) => part !== "");
        const fileName = parts[parts.length - 1];

        // Navigate to parent directory, creating as needed
        let currentHandle = this.rootHandle;
        for (let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: true });
        }

        // Create the file
        const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();

        // Get file metadata
        const fileObject = await fileHandle.getFile();

        return {
            path: p as FilePath,
            stat: {
                size: fileObject.size,
                mtime: fileObject.lastModified,
                ctime: fileObject.lastModified,
                type: "file",
            },
            handle: fileHandle,
        };
    }

    async createBinary(p: string, data: ArrayBuffer, options?: UXDataWriteOptions): Promise<FSAPIFile> {
        const parts = p.split("/").filter((part) => part !== "");
        const fileName = parts[parts.length - 1];

        // Navigate to parent directory, creating as needed
        let currentHandle = this.rootHandle;
        for (let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: true });
        }

        // Create the file
        const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();

        // Get file metadata
        const fileObject = await fileHandle.getFile();

        return {
            path: p as FilePath,
            stat: {
                size: fileObject.size,
                mtime: fileObject.lastModified,
                ctime: fileObject.lastModified,
                type: "file",
            },
            handle: fileHandle,
        };
    }

    async rename(file: FSAPIFile, newPath: string): Promise<void> {
        const source = await file.handle.getFile();
        const data = await source.arrayBuffer();
        const oldPath = file.path;
        const oldPathParts = oldPath.split("/");
        const oldName = oldPathParts.pop() ?? "file";
        const temporaryName = `.${oldName}.livesync-rename-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
        const temporaryPath = [...oldPathParts, temporaryName].join("/");
        const temporaryFile = await this.createBinary(temporaryPath, data);

        try {
            await this.delete(file);
        } catch (error) {
            await this.delete(temporaryFile, true);
            throw error;
        }

        try {
            const renamedFile = await this.createBinary(newPath, data);
            file.path = renamedFile.path;
            file.stat = renamedFile.stat;
            file.handle = renamedFile.handle;
        } catch (error) {
            try {
                const restoredFile = await this.createBinary(oldPath, data);
                file.path = restoredFile.path;
                file.stat = restoredFile.stat;
                file.handle = restoredFile.handle;
                await this.delete(temporaryFile, true);
            } catch (restoreError) {
                throw new Error(
                    `Could not rename ${oldPath} to ${newPath}, or restore it. A temporary copy remains at ${temporaryPath}. Rename error: ${String(error)}. Restore error: ${String(restoreError)}`
                );
            }
            throw error;
        }

        await this.delete(temporaryFile, true);
    }

    async delete(file: FSAPIFile | FSAPIFolder, force = false): Promise<void> {
        const parts = file.path.split("/").filter((part) => part !== "");
        const name = parts[parts.length - 1];

        // Navigate to parent directory
        let currentHandle = this.rootHandle;
        for (let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
        }

        // Remove the entry
        await currentHandle.removeEntry(name, { recursive: force });
    }

    async trash(file: FSAPIFile | FSAPIFolder, force = false): Promise<void> {
        // In webapp, trash is the same as delete (no recycle bin)
        await this.delete(file, force);
    }

    trigger(name: string, ...data: unknown[]): void {
        // No-op in webapp version (no event system yet)
    }
}
