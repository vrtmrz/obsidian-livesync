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

    trigger(name: string, ...data: any[]): any {
        // No-op in webapp version (no event system yet)
        return undefined;
    }
}
